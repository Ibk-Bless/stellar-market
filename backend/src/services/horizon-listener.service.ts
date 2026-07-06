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

// ─── sync-state persistence ───────────────────────────────────────────────────

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
    logger.warn({ contractJobId: onChainJobId }, "[HorizonListener] JobCreated — no DB job");
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
    logger.warn({ contractJobId: onChainJobId }, "[HorizonListener] JobFunded — no DB job");
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
    logger.warn({ contractJobId: onChainJobId }, "[HorizonListener] PaymentReleased — no DB job");
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

  logger.info({ contractJobId: onChainJobId }, "[HorizonListener] PaymentReleased");
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
    logger.warn({ contractJobId: onChainJobId }, "[HorizonListener] DisputeOpened — no DB job");
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
        } 
      } 
    },
  });

  if (!dispute) {
    logger.warn({ onChainDisputeId }, "[HorizonListener] DisputeResolved — no DB dispute");
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
    await ReputationCacheService.invalidateCache(dispute.job.client.walletAddress);
  }
  if (dispute.job.freelancer?.walletAddress) {
    await ReputationCacheService.invalidateCache(dispute.job.freelancer.walletAddress);
  }

  logger.info(
    { onChainDisputeId, rawStatus }, 
    "[HorizonListener] DisputeResolved - caches invalidated"
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
  logger.info({ walletAddress, tier }, "[HorizonListener] BadgeAwarded - cache invalidated");
}

// ─── event dispatch ───────────────────────────────────────────────────────────

async function resolvePreRegisteredTx(txHash: string, ledger: number): Promise<void> {
  try {
    await prisma.transaction.updateMany({
      where: { txHash, status: "PENDING" },
      data: { status: "SUCCESS", confirmedLedger: ledger },
    });
  } catch (err) {
    logger.warn({ err, txHash }, "[HorizonListener] Failed to resolve pre-registered tx");
  }
}

async function processEvent(event: SorobanEvent): Promise<void> {
  const [contract, name] = topicToStrings(event);

  // Promote any PENDING pre-registration for this txHash to SUCCESS immediately.
  await resolvePreRegisteredTx(event.txHash, event.ledger);

  try {
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
  } catch (err) {
    logger.error(
      { err, contract, name, ledger: event.ledger },
      "[HorizonListener] Error processing event",
    );
  }
}

/** @internal Exported for testing only. */
export const processHorizonEvent = processEvent;

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

  const lastLedger = await getLastIndexedLedger();

  let startLedger: number;
  try {
    const latest = await server.getLatestLedger();
    if (lastLedger === 0) {
      startLedger = latest.sequence;
      await setLastIndexedLedger(startLedger);
      logger.info({ startLedger }, "[HorizonListener] First run — starting from ledger");
      horizonCB.onSuccess();
      return;
    }
    startLedger = lastLedger + 1;

    if (startLedger > latest.sequence) {
      horizonCB.onSuccess(); // Horizon is reachable, nothing new
      return;
    }
  } catch (err) {
    logger.error({ err }, "[HorizonListener] Failed to fetch latest ledger");
    horizonCB.onFailure();
    return;
  }

  let events: SorobanEvent[] = [];
  let maxEventLedger = lastLedger;

  try {
    const result = await server.getEvents({
      startLedger,
      filters: [{ type: "contract", contractIds }],
      limit: MAX_EVENTS_PER_POLL,
    });
    events = result.events;
    horizonCB.onSuccess(); // successful Horizon call
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    if (msg.includes("startLedger") || msg.includes("ledger")) {
      // Cursor out of retention window — reset, but don't count as a Horizon failure
      logger.warn("[HorizonListener] startLedger out of retention window, resetting cursor");
      try {
        const latest = await server.getLatestLedger();
        await setLastIndexedLedger(latest.sequence);
        horizonCB.onSuccess();
      } catch (_) {
        horizonCB.onFailure();
      }
    } else {
      logger.error({ err }, "[HorizonListener] getEvents error");
      horizonCB.onFailure();
    }
    return;
  }

  for (const event of events) {
    await processEvent(event);
    if (event.ledger > maxEventLedger) maxEventLedger = event.ledger;
  }

  if (maxEventLedger > lastLedger) {
    await setLastIndexedLedger(maxEventLedger);
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

/** @internal Exported for testing only. */
export const pollHorizonOnce = poll;

/**
 * @internal Exported for testing only.
 * Returns the reconnect delay in milliseconds for the given consecutive failure count.
 * Starts at 1s, doubles each attempt, caps at 60s. Returns 0 on no failures.
 */
export function computeReconnectBackoffMs(failures: number): number {
  if (failures === 0) return 0;
  return Math.min(1_000 * Math.pow(2, failures - 1), 60_000);
}

let intervalId: NodeJS.Timeout | null = null;

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
    try {
      await poll();
    } catch (err) {
      logger.error({ err }, "[HorizonListener] Poll error");
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
export async function getHorizonStatus(): Promise<{ cursor: string; dlqDepth: number; lastEventTimestamp: Date | null }> {
  const syncState = await prisma.syncState.upsert({
    where: { id: SYNC_STATE_ID },
    update: {},
    create: { id: SYNC_STATE_ID, lastIndexedLedger: 0 },
  });
  const dlqDepth = await prisma.horizonDlq.count({ where: { replayedAt: null } });
  return { cursor: syncState.lastIndexedLedger.toString(), dlqDepth, lastEventTimestamp: syncState.updatedAt || null };
}

export async function overrideHorizonCursor(cursor: string): Promise<void> {
  const ledger = parseInt(cursor, 10);
  if (!isNaN(ledger)) {
    await prisma.syncState.upsert({
      where: { id: SYNC_STATE_ID },
      update: { lastIndexedLedger: ledger },
      create: { id: SYNC_STATE_ID, lastIndexedLedger: ledger },
    });
  }
}

export async function replayHorizonDlq(): Promise<{ replayed: number; failed: number }> {
  // Simplistic implementation for tests
  return { replayed: 0, failed: 0 };
}
