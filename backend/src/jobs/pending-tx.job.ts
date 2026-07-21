import { PrismaClient } from "@prisma/client";
import { rpc } from "@stellar/stellar-sdk";
import { config } from "../config";
import { logger } from "../lib/logger";

const prisma = new PrismaClient();
const rpcServer = new rpc.Server(config.stellar.rpcUrl);

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;
// Only start checking transactions that are at least this old (1 ledger ≈ 5 s)
const MIN_AGE_MS = 15_000;

async function checkPendingTransactions(): Promise<void> {
  const cutoff = new Date(Date.now() - MIN_AGE_MS);

  const pending = await prisma.transaction.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: cutoff },
    },
    select: { id: true, txHash: true, maxLedger: true },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" },
  });

  if (pending.length === 0) return;

  logger.info({ count: pending.length }, "[PendingTxJob] Checking pending transactions");

  for (const tx of pending) {
    try {
      const result = await rpcServer.getTransaction(tx.txHash);

      if (result.status === "SUCCESS") {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: "SUCCESS",
            confirmedLedger: (result as any).ledger ?? null,
          },
        });
        logger.info({ txHash: tx.txHash }, "[PendingTxJob] Marked SUCCESS");
        continue;
      }

      if (result.status === "FAILED") {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: "FAILED" },
        });
        logger.info({ txHash: tx.txHash }, "[PendingTxJob] Marked FAILED");
        continue;
      }

      // NOT_FOUND — check expiry if maxLedger is set. `maxLedger` stores
      // `tx.timeBounds.maxTime`, a Unix timestamp in seconds (set in
      // submitWithPreRegistration), not a ledger sequence number, so it must
      // be compared against wall-clock time rather than `getLatestLedger().sequence`
      // (which is orders of magnitude smaller and would never trip this check).
      if (tx.maxLedger != null) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (nowSeconds > tx.maxLedger) {
          await prisma.transaction.update({
            where: { id: tx.id },
            data: { status: "EXPIRED" },
          });
          logger.info({ txHash: tx.txHash, maxLedger: tx.maxLedger }, "[PendingTxJob] Marked EXPIRED");
        }
      }
    } catch (err) {
      logger.error({ err, txHash: tx.txHash }, "[PendingTxJob] Error checking transaction");
    }
  }
}

export function startPendingTxJob(): void {
  checkPendingTransactions();
  setInterval(checkPendingTransactions, POLL_INTERVAL_MS);
  logger.info("[PendingTxJob] Scheduled — runs every 30s");
}

// Export for tests
export { checkPendingTransactions };
