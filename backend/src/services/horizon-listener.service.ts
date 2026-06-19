import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  PrismaClient,
  BadgeTier,
  Prisma,
  Notification,
  NotificationType,
} from "@prisma/client";
import { config } from "../config";
import { NotificationService } from "./notification.service";
import { logger } from "../lib/logger";
import { CircuitBreaker } from "../lib/circuit-breaker";
import type { CircuitBreakerStatus } from "../lib/circuit-breaker";

export type { CircuitBreakerStatus };
export type { CircuitState } from "../lib/circuit-breaker";

const prisma = new PrismaClient();
const server = new rpc.Server(config.stellar.rpcUrl);

const POLL_INTERVAL_MS = 5_000;
const MAX_EVENTS_PER_POLL = 200;
const CURSOR_ID = 1;
const MAX_PROCESSING_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

// ─── Circuit Breaker instance ─────────────────────────────────────────────────

const horizonCB = new CircuitBreaker({
  failureThreshold: 5,
  openDurationMs: 60_000,
  name: "HorizonListener",
});

/** Derive the health string exposed on GET /health. */
export function getHorizonListenerHealth(): "connected" | "degraded" | "down" {
  return horizonCB.getHealthLabel();
}

/** Full circuit-breaker status (for tests / internal use). */
export function getCircuitBreakerStatus(): Readonly<CircuitBreakerStatus> {
  return horizonCB.getStatus();
}

// ─── Soroban event types ──────────────────────────────────────────────────────

type SorobanEvent = Awaited<ReturnType<typeof server.getEvents>>["events"][number];
type TransactionClient = Prisma.TransactionClient;

interface PendingNotification {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Prisma.InputJsonValue;
  skipBatching?: boolean;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function topicToStrings(event: SorobanEvent): string[] {
  return event.topic.map((t) => String(scValToNative(t) ?? ""));
}

/** Handles both plain-string and single-element-array Soroban enum variants. */
function enumVariant(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return String(raw[0]);
  return String(raw ?? "");
}

function bigintToStr(v: unknown): string {
  return typeof v === "bigint" ? v.toString() : String(v ?? "");
}

function toBadgeTier(raw: unknown): BadgeTier | null {
  const v = enumVariant(raw).toUpperCase();
  if (v === "BRONZE") return BadgeTier.BRONZE;
  if (v === "SILVER") return BadgeTier.SILVER;
  if (v === "GOLD") return BadgeTier.GOLD;
  if (v === "PLATINUM") return BadgeTier.PLATINUM;
  return null;
}

// ─── cursor persistence ───────────────────────────────────────────────────────

async function getCursor(): Promise<string> {
  const row = await prisma.horizonCursor.upsert({
    where: { id: CURSOR_ID },
    update: {},
    create: { id: CURSOR_ID, cursor: "0" },
  });
  return row.cursor;
}

async function setCursor(
  tx: TransactionClient,
  cursor: string,
  lastEventAt?: Date,
): Promise<void> {
  await tx.horizonCursor.upsert({
    where: { id: CURSOR_ID },
    update: { cursor, ...(lastEventAt ? { lastEventAt } : {}) },
    create: { id: CURSOR_ID, cursor, lastEventAt },
  });
}

// ─── event handlers ───────────────────────────────────────────────────────────

/**
 * escrow / created — (job_count: u64, client: Address, freelancer: Address)
 */
async function handleJobCreated(
  tx: TransactionClient,
  event: SorobanEvent,
): Promise<PendingNotification[]> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 1) return [];

  const onChainJobId = bigintToStr(data[0]);

  await tx.job.updateMany({
    where: {
      contractJobId: onChainJobId,
      escrowStatus: { not: "FUNDED" },
    },
    data: { escrowStatus: "UNFUNDED" },
  });

  logger.info({ contractJobId: onChainJobId }, "[HorizonListener] JobCreated");
  return [];
}

/**
 * escrow / funded — (job_id: u64, client: Address)
 */
async function handleJobFunded(
  tx: TransactionClient,
  event: SorobanEvent,
): Promise<PendingNotification[]> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 1) return [];

  const onChainJobId = bigintToStr(data[0]);

  await tx.job.updateMany({
    where: {
      contractJobId: onChainJobId,
      escrowStatus: "UNFUNDED",
    },
    data: { escrowStatus: "FUNDED", status: "IN_PROGRESS" },
  });

  logger.info({ contractJobId: onChainJobId }, "[HorizonListener] JobFunded");
  return [];
}

/**
 * escrow / pmt_released — (job_id: u64, freelancer: Address, amount: i128)
 */
async function handlePaymentReleased(
  tx: TransactionClient,
  event: SorobanEvent,
): Promise<PendingNotification[]> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 1) return [];

  const onChainJobId = bigintToStr(data[0]);

  const updated = await tx.job.updateMany({
    where: {
      contractJobId: onChainJobId,
      status: { not: "COMPLETED" },
    },
    data: { escrowStatus: "COMPLETED", status: "COMPLETED" },
  });

  if (updated.count > 0) {
    const job = await tx.job.findFirst({
      where: { contractJobId: onChainJobId },
      select: { clientId: true, freelancerId: true, title: true },
    });
    if (job) {
      const notifications = [job.clientId, job.freelancerId]
        .filter(Boolean)
        .map((userId) => ({
          userId: userId as string,
          type: NotificationType.PAYMENT_RELEASED,
          title: "Payment Released",
          message: `All payments for "${job.title}" have been released on-chain.`,
          metadata: { contractJobId: onChainJobId },
          skipBatching: true,
        }));
      logger.info({ contractJobId: onChainJobId }, "[HorizonListener] PaymentReleased");
      return notifications;
    }
  }

  logger.info({ contractJobId: onChainJobId }, "[HorizonListener] PaymentReleased");
  return [];
}

/**
 * dispute / raised — (dispute_id: u64, job_id: u64, initiator: Address)
 */
async function handleDisputeOpened(
  tx: TransactionClient,
  event: SorobanEvent,
): Promise<PendingNotification[]> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 3) return [];

  const onChainDisputeId = bigintToStr(data[0]);
  const onChainJobId = bigintToStr(data[1]);

  const job = await tx.job.findFirst({
    where: { contractJobId: onChainJobId },
    select: { id: true, clientId: true, freelancerId: true, dispute: true },
  });

  if (!job) {
    logger.warn({ contractJobId: onChainJobId }, "[HorizonListener] DisputeOpened — no DB job");
    return [];
  }

  await tx.job.update({
    where: { id: job.id },
    data: { status: "DISPUTED", escrowStatus: "DISPUTED" },
  });

  await tx.dispute.upsert({
    where: { onChainDisputeId },
    update: { status: "OPEN" },
    create: {
      jobId: job.id,
      onChainDisputeId,
      clientId: job.clientId,
      freelancerId: job.freelancerId ?? job.clientId,
      initiatorId: job.clientId,
      reason: "Raised on-chain",
      status: "OPEN",
    },
  });

  logger.info({ onChainDisputeId }, "[HorizonListener] DisputeOpened");
  return [job.clientId, job.freelancerId]
    .filter(Boolean)
    .map((userId) => ({
      userId: userId as string,
      type: NotificationType.DISPUTE_RAISED,
      title: "Dispute Opened",
      message: "A dispute has been opened on-chain for your job.",
      metadata: { onChainDisputeId, contractJobId: onChainJobId },
    }));
}

/**
 * dispute / resolved — (dispute_id: u64, dispute_status: DisputeStatus)
 */
async function handleDisputeResolved(
  tx: TransactionClient,
  event: SorobanEvent,
): Promise<PendingNotification[]> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 2) return [];

  const onChainDisputeId = bigintToStr(data[0]);
  const rawStatus = enumVariant(data[1]);

  let dbDisputeStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED" = "RESOLVED";
  let jobStatus: "COMPLETED" | "CANCELLED" | null = null;
  let outcome: string = rawStatus;

  if (rawStatus === "ResolvedForClient") {
    jobStatus = "CANCELLED";
    outcome = "CLIENT_WINS";
  } else if (rawStatus === "ResolvedForFreelancer") {
    jobStatus = "COMPLETED";
    outcome = "FREELANCER_WINS";
  } else if (rawStatus === "RefundedBoth") {
    jobStatus = "CANCELLED";
    outcome = "REFUND_BOTH";
  } else if (rawStatus === "Escalated") {
    dbDisputeStatus = "IN_PROGRESS";
    outcome = "ESCALATED";
  }

  const dispute = await tx.dispute.findUnique({
    where: { onChainDisputeId },
    select: { id: true, jobId: true, clientId: true, freelancerId: true },
  });

  if (!dispute) {
    logger.warn({ onChainDisputeId }, "[HorizonListener] DisputeResolved — no DB dispute");
    return [];
  }

  await tx.dispute.update({
    where: { id: dispute.id },
    data: {
      status: dbDisputeStatus,
      outcome,
      resolvedAt: dbDisputeStatus === "RESOLVED" ? new Date() : null,
    },
  });

  if (jobStatus) {
    await tx.job.update({
      where: { id: dispute.jobId },
      data: {
        status: jobStatus,
        escrowStatus: jobStatus === "COMPLETED" ? "COMPLETED" : "CANCELLED",
      },
    });
  }

  logger.info({ onChainDisputeId, outcome }, "[HorizonListener] DisputeResolved");
  return [dispute.clientId, dispute.freelancerId]
    .filter(Boolean)
    .map((userId) => ({
      userId: userId as string,
      type: NotificationType.DISPUTE_RESOLVED,
      title: "Dispute Resolved",
      message: `The dispute has been resolved on-chain: ${outcome}.`,
      metadata: { onChainDisputeId, outcome },
    }));
}

/**
 * reput / badge — (user_address: Address, tier: ReputationTier)
 */
async function handleBadgeAwarded(
  tx: TransactionClient,
  event: SorobanEvent,
): Promise<PendingNotification[]> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 2) return [];

  const walletAddress = String(data[0] ?? "");
  const tier = toBadgeTier(data[1]);

  if (!walletAddress || !tier) return [];

  const user = await tx.user.findUnique({
    where: { walletAddress },
    select: { id: true },
  });

  if (!user) {
    logger.warn({ walletAddress }, "[HorizonListener] BadgeAwarded — no user");
    return [];
  }

  const result = await tx.badge.upsert({
    where: { userId_tier: { userId: user.id, tier } },
    update: {},
    create: {
      userId: user.id,
      tier,
      awardedLedger: event.ledger,
    },
  });

  if (result.awardedLedger === event.ledger) {
    return [{
      userId: user.id,
      type: NotificationType.BADGE_AWARDED,
      title: `${tier.charAt(0) + tier.slice(1).toLowerCase()} Badge Earned!`,
      message: `Congratulations! You earned a ${tier.toLowerCase()} reputation badge on-chain.`,
      metadata: { tier, awardedLedger: event.ledger },
      skipBatching: true,
    }];
  }

  logger.info({ walletAddress, tier }, "[HorizonListener] BadgeAwarded");
  return [];
}

// ─── event dispatch ───────────────────────────────────────────────────────────

async function dispatchEvent(
  tx: TransactionClient,
  event: SorobanEvent,
): Promise<PendingNotification[]> {
  const [contract, name] = topicToStrings(event);

  if (contract === "escrow") {
    if (name === "created") return handleJobCreated(tx, event);
    if (name === "funded") return handleJobFunded(tx, event);
    if (name === "pmt_released") return handlePaymentReleased(tx, event);
  }

  if (contract === "dispute") {
    if (name === "raised") return handleDisputeOpened(tx, event);
    if (name === "resolved") return handleDisputeResolved(tx, event);
  }

  if (contract === "reput" && name === "badge") {
    return handleBadgeAwarded(tx, event);
  }

  return [];
}

function eventCursor(event: SorobanEvent): string {
  const cursor = event.pagingToken;
  if (!cursor) {
    throw new Error("Stellar RPC event did not include a paging token");
  }
  return cursor;
}

function eventTimestamp(event: SorobanEvent): Date {
  const value = (event as SorobanEvent & { ledgerClosedAt?: string }).ledgerClosedAt;
  const timestamp = value ? new Date(value) : new Date();
  return Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
}

function serializeEvent(event: SorobanEvent): Prisma.InputJsonValue {
  const raw = event as SorobanEvent & Record<string, unknown>;
  return {
    pagingToken: eventCursor(event),
    type: String(raw.type ?? "contract"),
    ledger: event.ledger,
    ledgerClosedAt: String(raw.ledgerClosedAt ?? ""),
    contractId: String(raw.contractId ?? ""),
    txHash: String(raw.txHash ?? ""),
    inSuccessfulContractCall: Boolean(raw.inSuccessfulContractCall),
    topic: event.topic.map((value) => value.toXDR("base64")),
    value: event.value.toXDR("base64"),
  };
}

function deserializeEvent(payload: Prisma.JsonValue): SorobanEvent {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("Invalid Horizon DLQ payload");
  }

  const raw = payload as Record<string, Prisma.JsonValue>;
  if (!Array.isArray(raw.topic) || typeof raw.value !== "string") {
    throw new Error("Invalid Horizon DLQ event XDR");
  }

  return {
    pagingToken: String(raw.pagingToken),
    type: String(raw.type),
    ledger: Number(raw.ledger),
    ledgerClosedAt: String(raw.ledgerClosedAt),
    contractId: String(raw.contractId),
    txHash: String(raw.txHash),
    inSuccessfulContractCall: Boolean(raw.inSuccessfulContractCall),
    topic: raw.topic.map((value) => xdr.ScVal.fromXDR(String(value), "base64")),
    value: xdr.ScVal.fromXDR(raw.value, "base64"),
  } as unknown as SorobanEvent;
}

async function persistNotifications(
  tx: TransactionClient,
  notifications: PendingNotification[],
): Promise<Notification[]> {
  return Promise.all(
    notifications.map(({ skipBatching: _skipBatching, ...notification }) =>
      tx.notification.create({
        data: {
          ...notification,
          metadata: notification.metadata ?? {},
        },
      }),
    ),
  );
}

async function deliverNotifications(
  notifications: Notification[],
): Promise<void> {
  await Promise.all(
    notifications.map(async (notification) => {
      try {
        NotificationService.deliverPersistedNotification(notification);
      } catch (err) {
        logger.error(
          { err, userId: notification.userId, type: notification.type },
          "[HorizonListener] Notification delivery failed after event commit",
        );
      }
    }),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processEventAttempt(
  event: SorobanEvent,
): Promise<Notification[]> {
  const cursor = eventCursor(event);
  return prisma.$transaction(async (tx) => {
    const pendingNotifications = await dispatchEvent(tx, event);
    const notifications = await persistNotifications(tx, pendingNotifications);
    await setCursor(tx, cursor, eventTimestamp(event));
    return notifications;
  });
}

export async function processHorizonEvent(event: SorobanEvent): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_PROCESSING_ATTEMPTS; attempt += 1) {
    try {
      const notifications = await processEventAttempt(event);
      await deliverNotifications(notifications);
      return;
    } catch (err) {
      lastError = err;
      logger.warn(
        { err, cursor: eventCursor(event), attempt },
        "[HorizonListener] Event processing attempt failed",
      );
      if (attempt < MAX_PROCESSING_ATTEMPTS) {
        await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }

  const cursor = eventCursor(event);
  await prisma.$transaction(async (tx) => {
    await tx.horizonDlq.create({
      data: {
        cursor,
        payload: serializeEvent(event),
        error: errorMessage(lastError),
        attempt: MAX_PROCESSING_ATTEMPTS,
      },
    });
    await setCursor(tx, cursor, eventTimestamp(event));
  });

  logger.error(
    { cursor, err: lastError },
    "[HorizonListener] Event moved to DLQ; stream will continue",
  );
}

// ─── polling loop (circuit-breaker guarded) ───────────────────────────────────

export async function pollHorizonOnce(): Promise<void> {
  // Circuit breaker gate
  if (!horizonCB.allowRequest()) {
    const status = horizonCB.getStatus();
    logger.debug(
      { state: status.state, openedAt: status.openedAt },
      "[HorizonListener] Circuit open — skipping poll",
    );
    return;
  }

  const contractIds = [
    config.stellar.escrowContractId,
    config.stellar.disputeContractId,
    config.stellar.reputationContractId,
  ].filter(Boolean);

  if (contractIds.length === 0) {
    return;
  }

  const cursor = await getCursor();

  let events: SorobanEvent[] = [];

  try {
    const result = await server.getEvents({
      filters: [{ type: "contract", contractIds }],
      pagination: { cursor, limit: MAX_EVENTS_PER_POLL },
    } as Parameters<typeof server.getEvents>[0]);
    events = result.events;
    horizonCB.onSuccess(); // successful Horizon call
  } catch (err: any) {
    logger.error({ err, cursor }, "[HorizonListener] getEvents error");
    horizonCB.onFailure();
    return;
  }

  for (const event of events) {
    await processHorizonEvent(event);
  }
}

// ─── admin operations ─────────────────────────────────────────────────────────

export async function getHorizonStatus(): Promise<{
  cursor: string;
  dlqDepth: number;
  lastEventTimestamp: Date | null;
}> {
  const [cursor, dlqDepth] = await Promise.all([
    prisma.horizonCursor.upsert({
      where: { id: CURSOR_ID },
      update: {},
      create: { id: CURSOR_ID, cursor: "0" },
    }),
    prisma.horizonDlq.count({ where: { replayedAt: null } }),
  ]);

  return {
    cursor: cursor.cursor,
    dlqDepth,
    lastEventTimestamp: cursor.lastEventAt,
  };
}

export async function overrideHorizonCursor(cursor: string): Promise<void> {
  if (activePoll) {
    await activePoll;
  }
  await prisma.horizonCursor.upsert({
    where: { id: CURSOR_ID },
    update: { cursor },
    create: { id: CURSOR_ID, cursor },
  });
}

export async function replayHorizonDlq(): Promise<{
  replayed: number;
  failed: number;
}> {
  const entries = await prisma.horizonDlq.findMany({
    where: { replayedAt: null },
    orderBy: [{ cursor: "asc" }, { id: "asc" }],
  });

  let replayed = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const event = deserializeEvent(entry.payload);
      const notifications = await prisma.$transaction(async (tx) => {
        const pending = await dispatchEvent(tx, event);
        const persisted = await persistNotifications(tx, pending);
        await tx.horizonDlq.update({
          where: { id: entry.id },
          data: { replayedAt: new Date() },
        });
        return persisted;
      });
      await deliverNotifications(notifications);
      replayed += 1;
    } catch (err) {
      failed += 1;
      await prisma.horizonDlq.update({
        where: { id: entry.id },
        data: {
          attempt: { increment: 1 },
          error: errorMessage(err),
        },
      });
    }
  }

  return { replayed, failed };
}

// ─── public API ───────────────────────────────────────────────────────────────

let intervalId: NodeJS.Timeout | null = null;
let activePoll: Promise<void> | null = null;

export function startHorizonListener(): void {
  if (intervalId) return;

  const contractIds = [
    config.stellar.escrowContractId,
    config.stellar.disputeContractId,
    config.stellar.reputationContractId,
  ].filter(Boolean);

  if (contractIds.length === 0) {
    logger.info("[HorizonListener] No contract IDs configured — skipping");
    return;
  }

  logger.info(
    { intervalSeconds: POLL_INTERVAL_MS / 1_000 },
    "[HorizonListener] Starting",
  );
  logger.info({ contractIds }, "[HorizonListener] Watching contracts");

  const runPoll = async () => {
    if (activePoll) return;

    try {
      activePoll = pollHorizonOnce();
      await activePoll;
    } catch (err) {
      logger.error({ err }, "[HorizonListener] Poll error");
    } finally {
      activePoll = null;
    }
  };

  void runPoll();
  intervalId = setInterval(() => void runPoll(), POLL_INTERVAL_MS);
}

export function stopHorizonListener(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("[HorizonListener] Stopped");
  }
}
