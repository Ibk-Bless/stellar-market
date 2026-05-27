import { Router, Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
import { asyncHandler } from "../middleware/error";
import { validate } from "../middleware/validation";
import { freelancerSearchQuerySchema, getUserByIdParamSchema } from "../schemas";
import { searchFreelancers } from "../services/freelancer-search.service";
import { ReputationService } from "../services/reputation.service";

const router = Router();
const prisma = new PrismaClient();

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

    const topFreelancers = await prisma.user.findMany({
      where: {
        role: "FREELANCER",
        averageRating: { gte: 4.0 }, // Only show highly-rated freelancers
        reviewCount: { gt: 0 }, // Must have at least one review
      },
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

    // Get total count for pagination
    const total = await prisma.user.count({
      where: {
        role: "FREELANCER",
        averageRating: { gte: 4.0 },
        reviewCount: { gt: 0 },
      },
    });

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
