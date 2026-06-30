import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { NotificationService } from "../services/notification.service";
import { logger } from "../lib/logger";

const prisma = new PrismaClient();

const ONE_HOUR_MS = 60 * 60 * 1000;
const LOCK_TTL_MS = 55_000;
const LOCK_KEY = "lock:expiry-job";

async function acquireLock(redis: Redis): Promise<boolean> {
  const result = await redis.set(LOCK_KEY, "1", "PX", LOCK_TTL_MS, "NX");
  return result === "OK";
}

async function releaseLock(redis: Redis): Promise<void> {
  await redis.del(LOCK_KEY);
}

function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  if (!url) return null;
  try {
    return new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableReadyCheck: false,
    });
  } catch {
    return null;
  }
}

async function expireJobs(): Promise<void> {
  const now = new Date();
  logger.info({ at: now.toISOString() }, "[ExpiryJob] Running");

  try {
    const openExpired = await (prisma.job as any).findMany({
      where: {
        status: "OPEN",
        deadline: { lt: now },
      },
      select: { id: true, title: true, clientId: true },
    });

    for (const job of openExpired) {
      await (prisma.job as any).update({
        where: { id: job.id },
        data: { status: "EXPIRED" },
      });

      await NotificationService.sendNotification({
        userId: job.clientId,
        type: "CANCELLED" as any,
        title: "Job Expired",
        message: `Your job "${job.title}" has expired without being funded and has been closed.`,
      });

      logger.info({ jobId: job.id }, "[ExpiryJob] Marked OPEN job as EXPIRED");
    }

    const fundedExpired = await (prisma.job as any).findMany({
      where: {
        escrowStatus: "FUNDED",
        deadline: { lt: now },
        status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED"] },
      },
      select: { id: true, title: true, clientId: true, contractJobId: true },
    });

    for (const job of fundedExpired) {
      try {
        if (job.contractJobId) {
          logger.info(
            { contractJobId: job.contractJobId },
            "[ExpiryJob] expire_job stub for contract job",
          );
        }

        await (prisma.job as any).update({
          where: { id: job.id },
          data: { status: "EXPIRED" },
        });

        await NotificationService.sendNotification({
          userId: job.clientId,
          type: "CANCELLED" as any,
          title: "Funded Job Expired",
          message: `Your funded job "${job.title}" passed its deadline and has been marked as expired. Escrow refund will be processed.`,
        });

        logger.info({ jobId: job.id }, "[ExpiryJob] Marked FUNDED job as EXPIRED");
      } catch (err) {
        logger.error({ err, jobId: job.id }, "[ExpiryJob] Failed to expire funded job");
      }
    }

    logger.info(
      { openExpired: openExpired.length, fundedExpired: fundedExpired.length },
      "[ExpiryJob] Done",
    );
  } catch (err) {
    logger.error({ err }, "[ExpiryJob] Unhandled error");
  }
}

async function executeWithLock(): Promise<void> {
  const redis = getRedisClient();

  if (redis) {
    try {
      await redis.connect();
      const acquired = await acquireLock(redis);
      if (!acquired) {
        logger.debug("[ExpiryJob] Lock not acquired — another instance is handling the job");
        await redis.quit();
        return;
      }
    } catch (err) {
      logger.warn({ err }, "[ExpiryJob] Redis lock error, proceeding without lock");
    }
  } else {
    logger.debug("[ExpiryJob] No Redis configured, proceeding without distributed lock");
  }

  try {
    await expireJobs();
  } finally {
    if (redis) {
      try {
        await releaseLock(redis);
        await redis.quit();
      } catch {
        // Best-effort lock release
      }
    }
  }
}

export function startExpiryJob(): void {
  executeWithLock();
  setInterval(executeWithLock, ONE_HOUR_MS);
  logger.info("[ExpiryJob] Scheduled — runs every hour with distributed lock");
}
