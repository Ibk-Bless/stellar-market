import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";
import { validate } from "../middleware/validation";
import RedisClient from "../lib/redis";
import { NotificationService } from "../services/notification.service";
import { logger } from "../lib/logger";

const router = Router();
const prisma = new PrismaClient();

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max reports a single user may submit in a 24-hour rolling window. */
const REPORT_WINDOW_LIMIT = 10;
/** Redis TTL for the rolling counter (24 hours in seconds). */
const REPORT_WINDOW_TTL_S = 24 * 60 * 60;
/** Legacy per-hour rate-limit (hard HTTP 429 guard). */
const AUTO_FLAG_THRESHOLD = 3;

// ─── Rate limiter (hard HTTP guard — 5 per hour per user) ────────────────────

const reportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const userId = (req as AuthRequest).userId;
    if (userId) return String(userId);
    return (req.ip ?? req.socket?.remoteAddress ?? "anon").replace(/^::ffff:/i, "");
  },
  validate: { ip: false }, // IP is normalized in keyGenerator above
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res
      .status(429)
      .json({ error: "Report limit reached — you may submit up to 5 reports per hour" });
  },
});

// ─── Validation ───────────────────────────────────────────────────────────────

const TARGET_TYPES = ["JOB", "USER", "MESSAGE"] as const;

const createReportSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().min(1),
  reason: z.string().min(10, "Reason must be at least 10 characters").max(1000),
});

// ─── Redis helpers ────────────────────────────────────────────────────────────

/** Redis key for a reporter's 24-hour rolling counter. */
function reporterCountKey(reporterId: string): string {
  return `reporter:24h:${reporterId}`;
}

/**
 * Increment the reporter's 24-hour counter.
 * Returns the new count. Falls back to 0 on Redis unavailability so the
 * request is never blocked by a cache outage.
 */
async function incrementReporterCount(reporterId: string): Promise<number> {
  try {
    if (!RedisClient.isRedisConnected()) {
      await RedisClient.connect();
    }
    const redis = RedisClient.getInstance();
    const key = reporterCountKey(reporterId);
    const count = await redis.incr(key);
    // Set TTL only on the first increment so the window starts fresh
    if (count === 1) {
      await redis.expire(key, REPORT_WINDOW_TTL_S);
    }
    return count;
  } catch (err) {
    logger.warn({ err, reporterId }, "[ReportRoute] Redis counter unavailable — skipping abuse check");
    return 0;
  }
}

/**
 * Read the current 24-hour report count for a reporter without incrementing.
 */
async function getReporterCount(reporterId: string): Promise<number> {
  try {
    if (!RedisClient.isRedisConnected()) {
      await RedisClient.connect();
    }
    const redis = RedisClient.getInstance();
    const val = await redis.get(reporterCountKey(reporterId));
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

// ─── Admin notification helper ────────────────────────────────────────────────

async function notifyAdminsOfSuspiciousReporter(reporterId: string): Promise<void> {
  try {
    const admins = await (prisma.user as any).findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    await Promise.all(
      (admins as { id: string }[]).map((admin) =>
        NotificationService.sendNotification({
          userId: admin.id,
          type: "DISPUTE_RAISED", // reuse closest available type
          title: "Suspicious Reporter Flagged",
          message: `User ${reporterId} has been auto-flagged as a suspicious reporter after exceeding ${REPORT_WINDOW_LIMIT} reports in 24 hours.`,
          metadata: { reporterId, threshold: REPORT_WINDOW_LIMIT },
        })
      )
    );
  } catch (err) {
    logger.error({ err, reporterId }, "[ReportRoute] Failed to notify admins of suspicious reporter");
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/reports
 * Authenticated; rate-limited to 5 per user per hour (hard guard).
 *
 * Abuse detection:
 *  - Tracks report count per reporter over a rolling 24-hour Redis window.
 *  - After REPORT_WINDOW_LIMIT (10) reports in 24h, marks the reporter as
 *    isSuspiciousReporter in the DB and sends an admin notification.
 *  - Reports from suspicious reporters have requiresReview: true so they are
 *    queued for secondary admin review rather than acting immediately.
 */
router.post(
  "/",
  authenticate,
  reportRateLimiter,
  validate({ body: createReportSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const reporterId = req.userId!;
    const { targetType, targetId, reason } = req.body as {
      targetType: (typeof TARGET_TYPES)[number];
      targetId: string;
      reason: string;
    };

    // ── 1. Check if reporter is already flagged as suspicious ──────────────
    const reporter = await (prisma.user as any).findUnique({
      where: { id: reporterId },
      select: { isSuspiciousReporter: true },
    });

    const alreadySuspicious: boolean = reporter?.isSuspiciousReporter ?? false;

    // ── 2. Increment 24-hour rolling counter ───────────────────────────────
    const reportCount = await incrementReporterCount(reporterId);

    // ── 3. Determine if this report needs secondary review ─────────────────
    const requiresReview = alreadySuspicious || reportCount > REPORT_WINDOW_LIMIT;

    // ── 4. Persist the report ──────────────────────────────────────────────
    const report = await (prisma as any).report.create({
      data: {
        reporterId,
        targetType,
        targetId,
        reason,
        requiresReview,
      },
    });

    // ── 5. Flag reporter on first threshold breach ─────────────────────────
    if (!alreadySuspicious && reportCount >= REPORT_WINDOW_LIMIT) {
      await (prisma.user as any).update({
        where: { id: reporterId },
        data: { isSuspiciousReporter: true },
      });

      logger.warn(
        { reporterId, reportCount },
        "[ReportRoute] Reporter flagged as suspicious",
      );

      // Notify admins once (on first flag)
      await notifyAdminsOfSuspiciousReporter(reporterId);
    }

    // ── 6. Legacy: auto-flag the target user when they accumulate reports ──
    if (targetType === "USER" && !requiresReview) {
      const pendingCount = await (prisma as any).report.count({
        where: { targetId, targetType: "USER", status: "PENDING" },
      });

      if (pendingCount >= AUTO_FLAG_THRESHOLD) {
        await (prisma.user as any).update({
          where: { id: targetId },
          data: {
            isFlagged: true,
            flagReason: `Auto-flagged: ${pendingCount} pending community reports`,
          },
        });
      }
    }

    res.status(201).json({
      report,
      ...(requiresReview && {
        notice: "Your report has been received and will be reviewed by our team.",
      }),
    });
  }),
);

export default router;
