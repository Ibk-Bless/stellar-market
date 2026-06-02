import { Router, Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";
import { validate } from "../middleware/validation";
import { freelancerSearchQuerySchema, getUserByIdParamSchema } from "../schemas";
import { searchFreelancers } from "../services/freelancer-search.service";
import { ReputationService } from "../services/reputation.service";

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/freelancers/earnings
 * Get earnings summary, monthly chart data, and paginated transaction history for the authenticated freelancer.
 */
router.get(
  "/earnings",
  authenticate,
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),
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

    const { page = 1, limit = 10 } = req.query as { page: number; limit: number };
    const skip = (Number(page) - 1) * Number(limit);
    const wallet = user.walletAddress;

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
        totalEarned: totalEarnedAgg._sum.amount ?? 0,
        earnedThisMonth: earnedThisMonthAgg._sum.amount ?? 0,
        pendingRelease: pendingJobs._sum.budget ?? 0,
        activeEscrow: escrowJobs._sum.budget ?? 0,
      },
      monthlyEarnings: monthlyRaw,
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
          freelancer.walletAddress
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

    const reputation = await ReputationService.getReputation(freelancer.walletAddress);

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
