import { Router, Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";
import { validate } from "../middleware/validation";
import { freelancerSearchQuerySchema, getUserByIdParamSchema } from "../schemas";
import { searchFreelancers } from "../services/freelancer-search.service";
import { ReputationService } from "../services/reputation.service";
import { fetchOnChainPayments } from "../services/earnings-reconciliation.service";
import { logger } from "../lib/logger";
import { config } from "../config";

const router = Router();
const prisma = new PrismaClient();

const EARNING_TX_TYPES = ["RELEASE", "DISPUTE_PAYOUT"] as const;

/**
 * Default reconciliation/export window: last 90 days.
 * Used when the caller omits `from`/`to`.
 */
function defaultRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 90);
  return { from, to };
}

const dateRangeQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((q) => !(q.from && q.to) || q.from <= q.to, {
    message: "`from` must be on or before `to`",
    path: ["from"],
  });

function escapeCsv(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/freelancers/earnings
 * Get earnings summary, monthly + weekly chart data, category breakdown, and
 * paginated transaction history for the authenticated freelancer.
 *
 * Optional `from`/`to` (ISO dates) scope the weekly chart and category breakdown
 * so the dashboard chart, category panel, and reconciliation panel share one range.
 */
router.get(
  "/earnings",
  authenticate,
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
  }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.role !== "FREELANCER") {
      return res.status(403).json({ error: "Only freelancers can access earnings" });
    }

    const query = req.query as unknown as {
      page: number;
      limit: number;
      from?: Date;
      to?: Date;
    };
    const { page = 1, limit = 10 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const wallet = user.walletAddress;

    if (!wallet) {
      return res.status(400).json({ error: "Freelancer has no wallet address." });
    }

    const fallback = defaultRange();
    const rangeFrom = query.from ?? fallback.from;
    const rangeTo = query.to ?? fallback.to;

    // ── Summary stats ──
    const [totalEarnedAgg, earnedThisMonthAgg, pendingJobs, escrowJobs] = await Promise.all([
      // Total earned: all RELEASE + DISPUTE_PAYOUT to freelancer wallet
      prisma.transaction.aggregate({
        where: {
          toAddress: wallet,
          type: { in: ["RELEASE", "DISPUTE_PAYOUT"] },
        },
        _sum: { amount: true },
      }),
      // Earned this month
      prisma.transaction.aggregate({
        where: {
          toAddress: wallet,
          type: { in: ["RELEASE", "DISPUTE_PAYOUT"] },
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
        _sum: { amount: true },
      }),
      // Pending release: IN_PROGRESS jobs assigned to freelancer
      prisma.job.aggregate({
        where: {
          freelancerId: user.id,
          status: "IN_PROGRESS",
        },
        _sum: { budget: true },
      }),
      // Active escrow: FUNDED escrow jobs assigned to freelancer
      prisma.job.aggregate({
        where: {
          freelancerId: user.id,
          escrowStatus: "FUNDED",
        },
        _sum: { budget: true },
      }),
    ]);

    // ── Monthly earnings for last 12 months ──
    const monthlyRaw = await prisma.$queryRaw<Array<{ month: string; earnings: number }>>`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') as month,
        COALESCE(SUM(amount), 0)::float as earnings
      FROM "Transaction"
      WHERE "toAddress" = ${wallet}
        AND "type" IN ('RELEASE', 'DISPUTE_PAYOUT')
        AND "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY month ASC
    `;

    // ── Weekly earnings within the selected range (for the time-series chart) ──
    // Returned sparse (only weeks with earnings); the frontend fills zero-value gaps.
    const weeklyRaw = await prisma.$queryRaw<Array<{ week: string; earnings: number }>>`
      SELECT
        TO_CHAR(DATE_TRUNC('week', "createdAt"), 'YYYY-MM-DD') as week,
        COALESCE(SUM(amount), 0)::float as earnings
      FROM "Transaction"
      WHERE "toAddress" = ${wallet}
        AND "type" IN ('RELEASE', 'DISPUTE_PAYOUT')
        AND "createdAt" >= ${rangeFrom}
        AND "createdAt" <= ${rangeTo}
      GROUP BY DATE_TRUNC('week', "createdAt")
      ORDER BY week ASC
    `;

    // ── Category breakdown within the selected range ──
    // Derived from each job's category tag (not hardcoded).
    const categoryRaw = await prisma.$queryRaw<Array<{ category: string; earnings: number }>>`
      SELECT
        COALESCE(j."category", 'Uncategorized') as category,
        COALESCE(SUM(t.amount), 0)::float as earnings
      FROM "Transaction" t
      LEFT JOIN "Job" j ON j."id" = t."jobId"
      WHERE t."toAddress" = ${wallet}
        AND t."type" IN ('RELEASE', 'DISPUTE_PAYOUT')
        AND t."createdAt" >= ${rangeFrom}
        AND t."createdAt" <= ${rangeTo}
      GROUP BY COALESCE(j."category", 'Uncategorized')
      ORDER BY earnings DESC
    `;

    const categoryTotal = categoryRaw.reduce((sum, c) => sum + c.earnings, 0);
    const categoryBreakdown = categoryRaw.map((c) => ({
      category: c.category,
      earnings: c.earnings,
      percentage: categoryTotal > 0 ? (c.earnings / categoryTotal) * 100 : 0,
    }));

    // ── Transaction history (paginated) ──
    const whereTx = {
      toAddress: wallet,
      type: { in: ["RELEASE", "DISPUTE_PAYOUT"] } as any,
    };

    const [transactions, totalTx] = await Promise.all([
      prisma.transaction.findMany({
        where: whereTx,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              clientId: true,
              client: {
                select: {
                  id: true,
                  username: true,
                  avatarUrl: true,
                },
              },
            },
          },
          milestone: {
            select: {
              id: true,
              title: true,
              status: true,
            },
          },
        },
      }),
      prisma.transaction.count({ where: whereTx }),
    ]);

    res.json({
      summary: {
        totalEarned: totalEarnedAgg._sum?.amount ?? 0,
        earnedThisMonth: earnedThisMonthAgg._sum?.amount ?? 0,
        pendingRelease: pendingJobs._sum?.budget ?? 0,
        activeEscrow: escrowJobs._sum?.budget ?? 0,
      },
      monthlyEarnings: monthlyRaw,
      weeklyEarnings: weeklyRaw,
      categoryBreakdown,
      range: { from: rangeFrom.toISOString(), to: rangeTo.toISOString() },
      transactions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalTx,
        totalPages: Math.ceil(totalTx / Number(limit)),
      },
    });
  }),
);

/**
 * Resolve the authenticated user, asserting they are a freelancer with a wallet.
 * Returns the wallet on success, or writes an error response and returns null.
 */
async function requireFreelancerWallet(
  req: AuthRequest,
  res: Response,
): Promise<{ userId: string; wallet: string } | null> {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return null;
  }
  if (user.role !== "FREELANCER") {
    res.status(403).json({ error: "Only freelancers can access earnings" });
    return null;
  }
  if (!user.walletAddress) {
    res.status(400).json({ error: "Freelancer has no wallet address." });
    return null;
  }
  return { userId: user.id, wallet: user.walletAddress };
}

interface EarningsRecord {
  txHash: string;
  jobId: string | null;
  jobTitle: string | null;
  clientName: string | null;
  category: string | null;
  amount: number;
  createdAt: Date;
}

/** Load DB earnings (RELEASE / DISPUTE_PAYOUT) for a wallet within a date range. */
async function loadDbEarnings(
  wallet: string,
  from: Date,
  to: Date,
): Promise<EarningsRecord[]> {
  const txs = await prisma.transaction.findMany({
    where: {
      toAddress: wallet,
      type: { in: [...EARNING_TX_TYPES] as any },
      createdAt: { gte: from, lte: to },
    },
    orderBy: { createdAt: "desc" },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          category: true,
          client: { select: { username: true } },
        },
      },
    },
  });

  return txs.map((tx) => ({
    txHash: tx.txHash,
    jobId: tx.jobId,
    jobTitle: tx.job?.title ?? null,
    clientName: tx.job?.client?.username ?? null,
    category: tx.job?.category ?? null,
    amount: tx.amount ?? 0,
    createdAt: tx.createdAt,
  }));
}

/**
 * GET /api/freelancers/earnings/reconcile?from=<ISO>&to=<ISO>
 * Cross-check DB earnings records against on-chain escrow releases from Horizon.
 *
 * Returns three buckets:
 *  - matched: present in both Horizon and the DB (joined by jobId memo / txHash)
 *  - onChainOnly: settled on-chain but missing from the DB (indicates a sync failure)
 *  - dbOnly: recorded in the DB but not found on-chain in the window
 */
router.get(
  "/earnings/reconcile",
  authenticate,
  validate({ query: dateRangeQuerySchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const auth = await requireFreelancerWallet(req, res);
    if (!auth) return;

    const q = req.query as unknown as { from?: Date; to?: Date };
    const fallback = defaultRange();
    const from = q.from ?? fallback.from;
    const to = q.to ?? fallback.to;

    const dbRecords = await loadDbEarnings(auth.wallet, from, to);

    let onChainPayments: Awaited<ReturnType<typeof fetchOnChainPayments>>;
    try {
      onChainPayments = await fetchOnChainPayments(auth.wallet, from, to);
    } catch (err) {
      logger.error({ err, wallet: auth.wallet }, "[Reconciliation] Horizon fetch failed");
      return res.status(502).json({ error: "Unable to reach the Stellar network for reconciliation." });
    }

    // Index DB records by txHash and by jobId for matching.
    const dbByTxHash = new Map(dbRecords.map((r) => [r.txHash, r]));
    const dbByJobId = new Map(
      dbRecords.filter((r) => r.jobId).map((r) => [r.jobId as string, r]),
    );

    const matchedTxHashes = new Set<string>();
    const matched: Array<{
      txHash: string;
      jobId: string | null;
      jobTitle: string | null;
      amount: number;
      onChainAmount: number;
      createdAt: string;
    }> = [];
    const onChainOnly: Array<{
      txHash: string;
      memoJobId: string | null;
      amount: number;
      assetCode: string;
      createdAt: string;
      horizonUrl: string;
    }> = [];

    for (const payment of onChainPayments) {
      const dbRecord =
        dbByTxHash.get(payment.txHash) ??
        (payment.memoJobId ? dbByJobId.get(payment.memoJobId) : undefined);

      if (dbRecord) {
        matchedTxHashes.add(dbRecord.txHash);
        matched.push({
          txHash: payment.txHash,
          jobId: dbRecord.jobId,
          jobTitle: dbRecord.jobTitle,
          amount: dbRecord.amount,
          onChainAmount: payment.amount,
          createdAt: payment.createdAt,
        });
      } else {
        onChainOnly.push({
          txHash: payment.txHash,
          memoJobId: payment.memoJobId,
          amount: payment.amount,
          assetCode: payment.assetCode,
          createdAt: payment.createdAt,
          horizonUrl: `${config.stellar.horizonUrl.replace(/\/+$/, "")}/transactions/${payment.txHash}`,
        });
      }
    }

    const dbOnly = dbRecords
      .filter((r) => !matchedTxHashes.has(r.txHash))
      .map((r) => ({
        txHash: r.txHash,
        jobId: r.jobId,
        jobTitle: r.jobTitle,
        amount: r.amount,
        createdAt: r.createdAt.toISOString(),
      }));

    // on_chain_only entries indicate the DB failed to record a settled payment.
    if (onChainOnly.length > 0) {
      logger.warn(
        { userId: auth.userId, wallet: auth.wallet, count: onChainOnly.length },
        "[Reconciliation] On-chain payments missing from DB — possible sync failure",
      );
    }

    res.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        onChainCount: onChainPayments.length,
        dbCount: dbRecords.length,
        matchedCount: matched.length,
        onChainOnlyCount: onChainOnly.length,
        dbOnlyCount: dbOnly.length,
        allMatched: onChainOnly.length === 0 && dbOnly.length === 0,
      },
      matched,
      onChainOnly,
      dbOnly,
    });
  }),
);

/**
 * GET /api/freelancers/earnings/export?from=<ISO>&to=<ISO>&format=csv
 * Download earnings for a tax period as CSV. Reconciliation status is computed
 * against Horizon when reachable; otherwise rows fall back to "unverified".
 */
router.get(
  "/earnings/export",
  authenticate,
  validate({
    query: dateRangeQuerySchema.and(
      z.object({ format: z.enum(["csv"]).default("csv") }),
    ),
  }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const auth = await requireFreelancerWallet(req, res);
    if (!auth) return;

    const q = req.query as unknown as { from?: Date; to?: Date };
    const fallback = defaultRange();
    const from = q.from ?? fallback.from;
    const to = q.to ?? fallback.to;

    const dbRecords = await loadDbEarnings(auth.wallet, from, to);

    // Best-effort reconciliation so each row carries a status; export still
    // succeeds (rows marked "unverified") if Horizon is unreachable.
    const onChainTxHashes = new Set<string>();
    const onChainJobIds = new Set<string>();
    try {
      const payments = await fetchOnChainPayments(auth.wallet, from, to);
      for (const p of payments) {
        onChainTxHashes.add(p.txHash);
        if (p.memoJobId) onChainJobIds.add(p.memoJobId);
      }
    } catch (err) {
      logger.warn({ err, wallet: auth.wallet }, "[Export] Horizon unreachable — exporting without on-chain status");
    }

    const xlmUsdRate = Number(process.env.XLM_USD_RATE ?? "0");

    const header = [
      "date",
      "job_title",
      "client_name",
      "amount_xlm",
      "amount_usd",
      "tx_hash",
      "reconciliation_status",
    ];

    const lines = [header.join(",")];
    for (const r of dbRecords) {
      const reconciled =
        onChainTxHashes.has(r.txHash) || (r.jobId ? onChainJobIds.has(r.jobId) : false);
      const status = onChainTxHashes.size === 0 ? "unverified" : reconciled ? "matched" : "db_only";
      const usd = xlmUsdRate > 0 ? (r.amount * xlmUsdRate).toFixed(2) : "";
      lines.push(
        [
          escapeCsv(r.createdAt.toISOString().slice(0, 10)),
          escapeCsv(r.jobTitle ?? "N/A"),
          escapeCsv(r.clientName ?? "N/A"),
          escapeCsv(r.amount),
          escapeCsv(usd),
          escapeCsv(r.txHash),
          escapeCsv(status),
        ].join(","),
      );
    }

    const csv = lines.join("\n");
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="earnings-${fromStr}-to-${toStr}.csv"`,
    );
    res.send(csv);
  }),
);

/**
 * GET /api/freelancers/top
 * Get top freelancers leaderboard sorted by rating and review count.
 * Returns the highest-rated and most-reviewed freelancers.
 */
router.get(
  "/top",
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const category = req.query.category as string | undefined;

    const where: any = {
      role: "FREELANCER",
      averageRating: { gte: 4.0 },
      reviewCount: { gt: 0 },
    };

    if (category) {
      where.skills = { has: category };
    }

    const topFreelancers = await prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        bio: true,
        skills: true,
        availability: true,
        averageRating: true,
        reviewCount: true,
        walletAddress: true,
        createdAt: true,
      },
      orderBy: [
        { averageRating: "desc" },
        { reviewCount: "desc" },
        { createdAt: "asc" },
      ],
      take: limit,
      skip: offset,
    });

    // Fetch on-chain reputation for each freelancer
    const freelancersWithReputation = await Promise.all(
      topFreelancers.map(async (freelancer) => {
        const reputation = await ReputationService.getReputation(
          freelancer.walletAddress ?? ""
        );
        return {
          ...freelancer,
          reputation: reputation
            ? {
                totalScore: reputation.total_score.toString(),
                totalWeight: reputation.total_weight.toString(),
                reviewCount: reputation.review_count,
              }
            : null,
        };
      })
    );

    const total = await prisma.user.count({ where });

    res.json({
      data: freelancersWithReputation,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  })
);

/**
 * GET /api/freelancers/search
 * Public freelancer discovery with optional filters (skills, rating, availability, text).
 */
router.get(
  "/search",
  validate({ query: freelancerSearchQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as {
      page: number;
      limit: number;
      minRating?: number;
      available?: boolean;
      q?: string;
      skills?: string[];
    };

    const result = await searchFreelancers(prisma, {
      page: q.page,
      limit: q.limit,
      minRating: q.minRating,
      available: q.available,
      q: q.q,
      skills: q.skills,
    });

    res.json(result);
  })
);

router.get(
  "/:id",
  validate({ params: getUserByIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const freelancer = await prisma.user.findFirst({
      where: { id, role: "FREELANCER" },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        bio: true,
        role: true,
        skills: true,
        availability: true,
        averageRating: true,
        reviewCount: true,
        walletAddress: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!freelancer) {
      return res.status(404).json({ error: "Freelancer not found." });
    }

    const lastModified = freelancer.updatedAt ?? freelancer.createdAt;
    const etag = `W/"freelancer:${id}:${lastModified.toISOString()}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Last-Modified", lastModified.toUTCString());
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    const reputation = await ReputationService.getReputation(freelancer.walletAddress ?? "");

    res.json({
      ...freelancer,
      reputation: reputation ? {
        totalScore: reputation.total_score.toString(),
        totalWeight: reputation.total_weight.toString(),
        reviewCount: reputation.review_count,
      } : null
    });
  }),
);

export default router;
