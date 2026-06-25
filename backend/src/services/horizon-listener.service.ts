import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { PrismaClient, BadgeTier, EscrowEventType } from "@prisma/client";
import { config } from "../config";
import { NotificationService } from "./notification.service";
import { logger } from "../lib/logger";
import { CircuitBreaker } from "../lib/circuit-breaker";
import type { CircuitBreakerStatus } from "../lib/circuit-breaker";
import { handleEscrowEvent } from "./escrow-projection.service";
import { ReputationCacheService } from "./reputation-cache.service";

export type { CircuitBreakerStatus };
export type { CircuitState } from "../lib/circuit-breaker";

const prisma = new PrismaClient();
const server = new rpc.Server(config.stellar.rpcUrl);

const POLL_INTERVAL_MS = 5_000;
const MAX_EVENTS_PER_POLL = 200;
const SYNC_STATE_ID = "default";

// ─── Reconnect backoff (independent of the circuit breaker's open/half-open
// gating below — this controls how soon we *retry* after a failed poll) ──────

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

let consecutiveFailures = 0;
let disconnectedAt: number | null = null;

/** 1s, 2s, 4s, 8s, ... capped at 60s. */
export function computeReconnectBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BASE_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
}

function onPollFailure(err: unknown): void {
  consecutiveFailures += 1;

  if (disconnectedAt === null) {
    disconnectedAt = Date.now();
    logger.error(
      { err, metric: "horizon_listener_disconnected", consecutiveFailures },
      "[HorizonListener] Disconnected from Horizon",
    );
  }
}

function onPollSuccess(): void {
  if (disconnectedAt !== null) {
    const downtimeMs = Date.now() - disconnectedAt;
    logger.info(
      { metric: "horizon_listener_reconnected", downtimeMs },
      "[HorizonListener] Reconnected to Horizon",
    );
  }
  consecutiveFailures = 0;
  disconnectedAt = null;
}

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

type SorobanEvent = Awaited<
  ReturnType<typeof server.getEvents>
>["events"][number];

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

// ─── cursor persistence ───────────────────────────────────────────────────

async function getCursor(): Promise<string> {
  const row = await prisma.horizonCursor.findUnique({ where: { id: 1 } });
  return row?.cursor ?? "0";
}

async function setCursor(cursor: string): Promise<void> {
  await prisma.horizonCursor.upsert({
    where: { id: 1 },
    update: { cursor },
    create: { id: 1, cursor },
  });
}

// ─── dead-letter queue ────────────────────────────────────────────────────────

async function addToDLQ(
  cursor: string,
  payload: unknown,
  error: string,
): Promise<void> {
  await prisma.horizonDlq.create({
    data: {
      cursor,
      payload: payload as any,
      error,
      attempt: 1,
    },
  });
  logger.warn({ cursor, error }, "[HorizonListener] Event moved to DLQ");
}

export async function replayDLQ(): Promise<{
  success: number;
  failed: number;
}> {
  const entries = await prisma.horizonDlq.findMany({
    where: { replayedAt: null },
    orderBy: { cursor: "asc" },
  });

  let success = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      await processEvent(entry.payload as SorobanEvent);
      await prisma.horizonDlq.update({
        where: { id: entry.id },
        data: { replayedAt: new Date() },
      });
      success++;
      logger.info({ dlqId: entry.id }, "[HorizonListener] DLQ entry replayed");
    } catch (err: any) {
      await prisma.horizonDlq.update({
        where: { id: entry.id },
        data: {
          attempt: entry.attempt + 1,
          error: err?.message ?? "Unknown error",
        },
      });
      failed++;
      logger.error(
        { dlqId: entry.id, err },
        "[HorizonListener] DLQ replay failed",
      );
    }
  }

  return { success, failed };
}

export async function getDLQStatus(): Promise<{
  pending: number;
  total: number;
}> {
  const [pending, total] = await Promise.all([
    prisma.horizonDlq.count({ where: { replayedAt: null } }),
    prisma.horizonDlq.count(),
  ]);
  return { pending, total };
}

export async function getHorizonStatus(): Promise<{
  cursor: string;
  dlqPending: number;
  health: string;
}> {
  const cursor = await getCursor();
  const { pending } = await getDLQStatus();
  return {
    cursor,
    dlqPending: pending,
    health: getHorizonListenerHealth(),
  };
}

// ─── sync-state persistence (legacy — kept for badges) ────────────────────────

async function getLastIndexedLedger(): Promise<number> {
  const row = await prisma.syncState.upsert({
    where: { id: SYNC_STATE_ID },
    update: {},
    create: { id: SYNC_STATE_ID, lastIndexedLedger: 0 },
  });
  return row.lastIndexedLedger;
}

async function setLastIndexedLedger(ledger: number): Promise<void> {
  await prisma.syncState.upsert({
    where: { id: SYNC_STATE_ID },
    update: { lastIndexedLedger: ledger },
    create: { id: SYNC_STATE_ID, lastIndexedLedger: ledger },
  });
}

// ─── event handlers ───────────────────────────────────────────────────────────

/**
 * escrow / created — (job_count: u64, client: Address, freelancer: Address)
 */
async function handleJobCreated(event: SorobanEvent): Promise<void> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 1) return;

  const onChainJobId = bigintToStr(data[0]);

  const job = await prisma.job.findFirst({
    where: { contractJobId: onChainJobId },
    select: { id: true },
  });

  if (!job) {
    logger.warn(
      { contractJobId: onChainJobId },
      "[HorizonListener] JobCreated — no DB job",
    );
    return;
  }

  await handleEscrowEvent({
    jobId: job.id,
    contractJobId: onChainJobId,
    eventType: EscrowEventType.JOB_CREATED,
    ledgerSeq: event.ledger,
    txHash: event.txHash,
    payload: {},
  });

  logger.info({ contractJobId: onChainJobId }, "[HorizonListener] JobCreated");
}

/**
 * escrow / funded — (job_id: u64, client: Address)
 */
async function handleJobFunded(event: SorobanEvent): Promise<void> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 1) return;

  const onChainJobId = bigintToStr(data[0]);

  const job = await prisma.job.findFirst({
    where: { contractJobId: onChainJobId },
    select: { id: true },
  });

  if (!job) {
    logger.warn(
      { contractJobId: onChainJobId },
      "[HorizonListener] JobFunded — no DB job",
    );
    return;
  }

  await handleEscrowEvent({
    jobId: job.id,
    contractJobId: onChainJobId,
    eventType: EscrowEventType.JOB_FUNDED,
    ledgerSeq: event.ledger,
    txHash: event.txHash,
    payload: {},
  });

  logger.info({ contractJobId: onChainJobId }, "[HorizonListener] JobFunded");
}

/**
 * escrow / pmt_released — (job_id: u64, freelancer: Address, amount: i128)
 */
async function handlePaymentReleased(event: SorobanEvent): Promise<void> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 1) return;

  const onChainJobId = bigintToStr(data[0]);
  const amount = data.length >= 3 ? bigintToStr(data[2]) : "0";

  const job = await prisma.job.findFirst({
    where: { contractJobId: onChainJobId },
    select: { id: true },
  });

  if (!job) {
    logger.warn(
      { contractJobId: onChainJobId },
      "[HorizonListener] PaymentReleased — no DB job",
    );
    return;
  }

  await handleEscrowEvent({
    jobId: job.id,
    contractJobId: onChainJobId,
    eventType: EscrowEventType.PAYMENT_RELEASED,
    ledgerSeq: event.ledger,
    txHash: event.txHash,
    payload: { amount },
  });

  logger.info(
    { contractJobId: onChainJobId },
    "[HorizonListener] PaymentReleased",
  );
}

/**
 * dispute / raised — (dispute_id: u64, job_id: u64, initiator: Address)
 */
async function handleDisputeOpened(event: SorobanEvent): Promise<void> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 3) return;

  const onChainDisputeId = bigintToStr(data[0]);
  const onChainJobId = bigintToStr(data[1]);

  const job = await prisma.job.findFirst({
    where: { contractJobId: onChainJobId },
    select: { id: true },
  });

  if (!job) {
    logger.warn(
      { contractJobId: onChainJobId },
      "[HorizonListener] DisputeOpened — no DB job",
    );
    return;
  }

  await handleEscrowEvent({
    jobId: job.id,
    contractJobId: onChainJobId,
    eventType: EscrowEventType.DISPUTE_OPENED,
    ledgerSeq: event.ledger,
    txHash: event.txHash,
    payload: { onChainDisputeId },
  });

  logger.info({ onChainDisputeId }, "[HorizonListener] DisputeOpened");
}

/**
 * dispute / resolved — (dispute_id: u64, dispute_status: DisputeStatus)
 */
async function handleDisputeResolved(event: SorobanEvent): Promise<void> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 2) return;

  const onChainDisputeId = bigintToStr(data[0]);
  const rawStatus = enumVariant(data[1]);

  const dispute = await prisma.dispute.findUnique({
    where: { onChainDisputeId },
    select: {
      jobId: true,
      job: {
        select: {
          contractJobId: true,
          client: { select: { walletAddress: true } },
          freelancer: { select: { walletAddress: true } },
        },
      },
    },
  });

  if (!dispute) {
    logger.warn(
      { onChainDisputeId },
      "[HorizonListener] DisputeResolved — no DB dispute",
    );
    return;
  }

  await handleEscrowEvent({
    jobId: dispute.jobId,
    contractJobId: dispute.job.contractJobId ?? "",
    eventType: EscrowEventType.DISPUTE_RESOLVED,
    ledgerSeq: event.ledger,
    txHash: event.txHash,
    payload: { onChainDisputeId, rawStatus },
  });

  // Invalidate reputation cache for both client and freelancer (dispute affects reputation)
  if (dispute.job.client?.walletAddress) {
    await ReputationCacheService.invalidateCache(
      dispute.job.client.walletAddress,
    );
  }
  if (dispute.job.freelancer?.walletAddress) {
    await ReputationCacheService.invalidateCache(
      dispute.job.freelancer.walletAddress,
    );
  }

  logger.info(
    { onChainDisputeId, rawStatus },
    "[HorizonListener] DisputeResolved - caches invalidated",
  );
}

/**
 * reput / badge — (user_address: Address, tier: ReputationTier)
 */
async function handleBadgeAwarded(event: SorobanEvent): Promise<void> {
  const data = scValToNative(event.value) as unknown[];
  if (!Array.isArray(data) || data.length < 2) return;

  const walletAddress = String(data[0] ?? "");
  const tier = toBadgeTier(data[1]);

  if (!walletAddress || !tier) return;

  const user = await prisma.user.findUnique({
    where: { walletAddress },
    select: { id: true },
  });

  if (!user) {
    logger.warn({ walletAddress }, "[HorizonListener] BadgeAwarded — no user");
    return;
  }

  const result = await prisma.badge.upsert({
    where: { userId_tier: { userId: user.id, tier } },
    update: {},
    create: {
      userId: user.id,
      tier,
      awardedLedger: event.ledger,
    },
  });

  if (result.awardedLedger === event.ledger) {
    await NotificationService.sendNotification({
      userId: user.id,
      type: "BADGE_AWARDED",
      title: `${tier.charAt(0) + tier.slice(1).toLowerCase()} Badge Earned!`,
      message: `Congratulations! You earned a ${tier.toLowerCase()} reputation badge on-chain.`,
      metadata: { tier, awardedLedger: event.ledger },
      skipBatching: true,
    });
  }

  // Invalidate reputation cache for this user
  await ReputationCacheService.invalidateCache(walletAddress);
  logger.info(
    { walletAddress, tier },
    "[HorizonListener] BadgeAwarded - cache invalidated",
  );
}

// ─── event dispatch ───────────────────────────────────────────────────────────

async function resolvePreRegisteredTx(
  txHash: string,
  ledger: number,
): Promise<void> {
  try {
    await prisma.transaction.updateMany({
      where: { txHash, status: "PENDING" },
      data: { status: "SUCCESS", confirmedLedger: ledger },
    });
  } catch (err) {
    logger.warn(
      { err, txHash },
      "[HorizonListener] Failed to resolve pre-registered tx",
    );
  }
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 9000]; // exponential backoff

async function processEventWithRetry(
  event: SorobanEvent,
  attempt = 0,
): Promise<void> {
  try {
    await processEvent(event);
  } catch (err: any) {
    if (attempt < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS[attempt];
      logger.warn(
        { attempt: attempt + 1, delay, ledger: event.ledger },
        "[HorizonListener] Retrying event processing",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return processEventWithRetry(event, attempt + 1);
    }
    // After max retries, move to DLQ
    await addToDLQ(event.id, event, err?.message ?? "Unknown error");
    logger.error(
      { err, ledger: event.ledger, txHash: event.txHash },
      "[HorizonListener] Event processing failed after retries, moved to DLQ",
    );
  }
}

async function processEvent(event: SorobanEvent): Promise<void> {
  const [contract, name] = topicToStrings(event);

  // Promote any PENDING pre-registration for this txHash to SUCCESS immediately.
  await resolvePreRegisteredTx(event.txHash, event.ledger);

  if (contract === "escrow") {
    if (name === "created") return await handleJobCreated(event);
    if (name === "funded") return await handleJobFunded(event);
    if (name === "pmt_released") return await handlePaymentReleased(event);
  }

  if (contract === "dispute") {
    if (name === "raised") return await handleDisputeOpened(event);
    if (name === "resolved") return await handleDisputeResolved(event);
  }

  if (contract === "reput") {
    if (name === "badge") return await handleBadgeAwarded(event);
  }
}

// ─── polling loop (circuit-breaker guarded) ───────────────────────────────────

async function poll(): Promise<void> {
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
  let startLedger: number;

  try {
    const latest = await server.getLatestLedger();
    if (cursor === "0") {
      startLedger = latest.sequence;
      await setCursor(String(startLedger));
      await setLastIndexedLedger(startLedger); // Keep legacy sync for badges
      logger.info(
        { startLedger },
        "[HorizonListener] First run — starting from ledger",
      );
      horizonCB.onSuccess();
      onPollSuccess();
      return;
    }
    startLedger = Number(cursor) + 1;

    if (startLedger > latest.sequence) {
      horizonCB.onSuccess(); // Horizon is reachable, nothing new
      onPollSuccess();
      return;
    }
  } catch (err) {
    logger.error({ err }, "[HorizonListener] Failed to fetch latest ledger");
    horizonCB.onFailure();
    onPollFailure(err);
    return;
  }

  let events: SorobanEvent[] = [];
  let maxEventLedger = Number(cursor);

  try {
    const result = await server.getEvents({
      startLedger,
      filters: [{ type: "contract", contractIds }],
      limit: MAX_EVENTS_PER_POLL,
    });
    events = result.events;
    horizonCB.onSuccess(); // successful Horizon call
    onPollSuccess();
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    if (msg.includes("startLedger") || msg.includes("ledger")) {
      // Cursor out of retention window — reset, but don't count as a Horizon failure
      logger.warn(
        "[HorizonListener] startLedger out of retention window, resetting cursor",
      );
      try {
        const latest = await server.getLatestLedger();
        await setCursor(String(latest.sequence));
        await setLastIndexedLedger(latest.sequence);
        horizonCB.onSuccess();
        onPollSuccess();
      } catch (resetErr) {
        horizonCB.onFailure();
        onPollFailure(resetErr);
      }
    } else {
      logger.error({ err }, "[HorizonListener] getEvents error");
      horizonCB.onFailure();
      onPollFailure(err);
    }
    return;
  }

  for (const event of events) {
    await processEventWithRetry(event);
    if (event.ledger > maxEventLedger) maxEventLedger = event.ledger;
  }

  if (maxEventLedger > Number(cursor)) {
    await setCursor(String(maxEventLedger));
    await setLastIndexedLedger(maxEventLedger); // Keep legacy sync for badges
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

let timerId: NodeJS.Timeout | null = null;
let running = false;

export function startHorizonListener(): void {
  if (timerId || running) return;

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

  running = true;

  // Self-rescheduling loop (rather than a fixed setInterval) so a failed
  // poll can back off exponentially — 1s, 2s, 4s, 8s... capped at 60s —
  // instead of hammering an unreachable Horizon every POLL_INTERVAL_MS.
  const runPoll = async () => {
    try {
      await poll();
    } catch (err) {
      logger.error({ err }, "[HorizonListener] Poll error");
      onPollFailure(err);
    } finally {
      if (running) {
        const delay = consecutiveFailures > 0
          ? computeReconnectBackoffMs(consecutiveFailures)
          : POLL_INTERVAL_MS;
        timerId = setTimeout(() => void runPoll(), delay);
      }
    }
  };

  void runPoll();
}

export function stopHorizonListener(): void {
  running = false;
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
    logger.info("[HorizonListener] Stopped");
  }
}
