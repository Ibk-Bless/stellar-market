import { AuthRequest, authenticate } from "../middleware/auth";
import { Response, Router } from "express";
import { cache, generateUserCacheKey, invalidateCacheKey } from "../lib/cache";
import {
  getUserByIdParamSchema,
  getUserJobsQuerySchema,
  getUsersQuerySchema,
  updateCurrentUserProfileSchema,
  updateUserProfileSchema,
} from "../schemas";

import { PrismaClient } from "@prisma/client";
import { asyncHandler } from "../middleware/error";
import { avatarUpload } from "../config/upload";
import { validate } from "../middleware/validation";
import { ReputationService } from "../services/reputation.service";
import { normalizeSkills } from "../services/skill.service";
import { logger } from "../lib/logger";

const router = Router();
const prisma = new PrismaClient();

// GET /api/users/me — return current authenticated user's full profile
router.get("/me", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        username: true,
        walletAddress: true,
        email: true,
        emailVerified: true,
        password: true,
        bio: true,
        avatarUrl: true,
        role: true,
        skills: true,
        availability: true,
        completedOnboarding: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const { password: _password, ...safeUser } = user;
    res.json({
      ...safeUser,
      authMethods: {
        email: Boolean(user.email && user.password),
        wallet: Boolean(user.walletAddress),
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Get current user error");
    res.status(500).json({ error: "Internal server error." });
  }
});

// DELETE /api/users/me — soft-delete current authenticated user's account
router.delete("/me", authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;

  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() },
  });

  // Revoke all refresh tokens so any stored sessions are invalidated
  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { revoked: true },
  });

  res.json({ message: "Account deleted." });
}));

// PUT /api/users/me — update current authenticated user's profile
router.put(
  "/me",
  authenticate,
  validate({ body: updateCurrentUserProfileSchema }),
  async (req: AuthRequest, res: Response) => {
    try {
      const data = req.body as {
        username?: string;
        email?: string | null;
        bio?: string | null;
        role?: "CLIENT" | "FREELANCER";
        skills?: string[];
        availability?: boolean;
      };

      // Check username uniqueness if being updated
      if (data.username) {
        const existingUser = await prisma.user.findFirst({
          where: {
            username: data.username,
            NOT: { id: req.userId },
          },
        });
        if (existingUser) {
          res.status(409).json({ error: "Username is already taken." });
          return;
        }
      }

      // Normalise free-text skills against the canonical taxonomy so
      // "ReactJS" / "react.js" collapse to one searchable value ("React").
      if (data.skills) {
        data.skills = await normalizeSkills(data.skills);
      }

      // Check email uniqueness if being updated
      if (data.email) {
        const existingUser = await prisma.user.findFirst({
          where: {
            email: data.email,
            NOT: { id: req.userId },
          },
        });
        if (existingUser) {
          res.status(409).json({ error: "Email is already taken." });
          return;
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: req.userId },
        data,
        select: {
          id: true,
          username: true,
          walletAddress: true,
          email: true,
          bio: true,
          avatarUrl: true,
          role: true,
          skills: true,
          availability: true,
          createdAt: true,
        },
      });

      // Invalidate user profile cache
      if (req.userId) {
        await invalidateCacheKey(generateUserCacheKey(req.userId));
      }

      res.json(updatedUser);
    } catch (error) {
      logger.error({ err: error }, "Update profile error");
      res.status(500).json({ error: "Internal server error." });
    }
});

router.post(
  "/me/avatar",
  authenticate,
  avatarUpload.single("avatar"),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded. Use field name 'avatar'." });
        return;
      }
      const avatarUrl = `/api/uploads/avatars/${req.file.filename}`;
      const updated = await prisma.user.update({
        where: { id: req.userId },
        data: { avatarUrl },
        select: {
          id: true,
          username: true,
          avatarUrl: true,
        },
      });
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Avatar upload error");
      res.status(500).json({ error: "Internal server error." });
    }
  },
);

router.get(
  "/:id/jobs",
  validate({
    params: getUserByIdParamSchema,
    query: getUserJobsQuerySchema,
  }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const query = req.query as { page?: number; limit?: number };
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where: {
          OR: [{ clientId: id }, { freelancerId: id }],
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          client: { select: { id: true, username: true, avatarUrl: true } },
          freelancer: { select: { id: true, username: true, avatarUrl: true } },
          _count: { select: { applications: true } },
        },
      }),
      prisma.job.count({
        where: {
          OR: [{ clientId: id }, { freelancerId: id }],
        },
      }),
    ]);

    res.json({
      data: jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }),
);

router.get(
  "/:id/reviews",
  validate({ params: getUserByIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const query = req.query as { type?: string; page?: string; limit?: string };
    const type = query.type === "given" ? "given" : "received";
    const page = parseInt(query.page || "1", 10);
    const limit = parseInt(query.limit || "10", 10);
    const skip = (page - 1) * limit;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const where = type === "given" ? { reviewerId: id } : { revieweeId: id };

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          reviewer: { select: { id: true, username: true, avatarUrl: true } },
          reviewee: { select: { id: true, username: true, avatarUrl: true } },
          job: { select: { id: true, title: true } },
        },
      }),
      prisma.review.count({ where }),
    ]);

    const data = reviews.map((r: any) => {
      const targetUser = type === "given" ? r.reviewee : r.reviewer;
      return {
        id: r.id,
        jobId: r.jobId,
        jobTitle: r.job.title,
        reviewer: {
          id: targetUser.id,
          name: targetUser.username,
          avatarUrl: targetUser.avatarUrl,
        },
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
      };
    });

    const meta: any = {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    if (type === "received") {
      meta.averageRating = user.averageRating || 0;
    }

    res.json({
      data,
      meta,
    });
  }),
);

// GET /api/users/public/:username — public profile by username (no auth, no sensitive fields)
router.get(
  "/public/:username",
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const username = _req.params.username as string;

    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        bio: true,
        avatarUrl: true,
        role: true,
        skills: true,
        averageRating: true,
        reviewCount: true,
        createdAt: true,
        reviewsReceived: {
          orderBy: { createdAt: "desc" as const },
          take: 10,
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            reviewer: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
        freelancerJobs: {
          where: { status: "COMPLETED" },
          orderBy: { updatedAt: "desc" as const },
          take: 10,
          select: {
            id: true,
            title: true,
            category: true,
            createdAt: true,
          },
        },
        portfolioItems: {
          where: {},
          orderBy: { displayOrder: "asc" as const },
          select: {
            id: true,
            title: true,
            description: true,
            fileUrl: true,
            fileName: true,
            mimeType: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    res.json(user);
  }),
);

// Get user profile by ID
router.get(
  "/:id",
  validate({ params: getUserByIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const cacheKey = generateUserCacheKey(id);

    try {
      const { data, hit } = await cache(cacheKey, 300, async () => {
        const user = await prisma.user.findUnique({
          where: { id },
          select: {
            id: true,
            username: true,
            bio: true,
            avatarUrl: true,
            role: true,
            skills: true,
            walletAddress: true,
            availability: true,
            averageRating: true,
            reviewCount: true,
            createdAt: true,
            reviewsReceived: {
              orderBy: { createdAt: "desc" as const },
              select: {
                id: true,
                rating: true,
                comment: true,
                createdAt: true,
                reviewer: {
                  select: {
                    id: true,
                    username: true,
                    avatarUrl: true,
                  },
                },
              },
            },
            clientJobs: {
              where: { status: "COMPLETED" },
              orderBy: { updatedAt: "desc" as const },
              select: {
                id: true,
                title: true,
                category: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            freelancerJobs: {
              where: { status: "COMPLETED" },
              orderBy: { updatedAt: "desc" as const },
              select: {
                id: true,
                title: true,
                category: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });

        if (!user) {
          throw new Error("User not found");
        }

        if (user.role === "FREELANCER" && user.walletAddress) {
          const reputation = await ReputationService.getReputation(user.walletAddress);
          if (reputation) {
            (user as any).reputation = {
              totalScore: reputation.total_score.toString(),
              totalWeight: reputation.total_weight.toString(),
              reviewCount: reputation.review_count,
            };
          }
        }

        return user;
      });

      res.set("X-Cache-Hit", hit.toString());
      res.json(data);
    } catch (error) {
      if (error instanceof Error && error.message === "User not found") {
        return res.status(404).json({ error: "User not found." });
      }
      throw error;
    }
  }),
);

// Get all users with pagination and filtering
router.get(
  "/",
  validate({ query: getUsersQuerySchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, skill, role } = req.query as any;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { username: { contains: search, mode: "insensitive" } },
        { bio: { contains: search, mode: "insensitive" } },
      ];
    }

    if (skill) {
      where.skills = {
        has: skill,
      };
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          username: true,
          walletAddress: true,
          bio: true,
          avatarUrl: true,
          role: true,
          skills: true,
          availability: true,
          averageRating: true,
          reviewCount: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);

    const usersWithReputation = await Promise.all(
      users.map(async (user: any) => {
        if (user.role === "FREELANCER" && user.walletAddress) {
          const reputation = await ReputationService.getReputation(user.walletAddress);
          return {
            ...user,
            reputation: reputation ? {
              totalScore: reputation.total_score.toString(),
              totalWeight: reputation.total_weight.toString(),
              reviewCount: reputation.review_count,
            } : null,
          };
        }
        return user;
      })
    );

    res.json({
      users: usersWithReputation,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  }),
);

// PATCH /api/users/me/onboarding — mark onboarding complete
router.patch("/me/onboarding", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { completedOnboarding: true },
      select: { id: true, completedOnboarding: true },
    });
    res.json(user);
  } catch (error) {
    logger.error({ err: error }, "Complete onboarding error");
    res.status(500).json({ error: "Internal server error." });
  }
});

// Update user profile
router.put(
  "/:id",
  authenticate,
  validate({
    params: getUserByIdParamSchema,
    body: updateUserProfileSchema,
  }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const updateData = req.body;

    if (req.userId !== id) {
      return res
        .status(403)
        .json({ error: "Not authorized to update this profile." });
    }

    const body = updateData as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (body.email !== undefined) data.email = body.email;
    if (body.bio !== undefined) data.bio = body.bio;
    if (body.skills !== undefined) data.skills = body.skills;
    if (body.availability !== undefined) data.availability = body.availability;
    if (body.name !== undefined) data.username = body.name;
    // walletAddress is never written here — use POST /auth/wallet/challenge
    // then POST /auth/wallet/verify to prove key ownership before binding.

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        walletAddress: true,
        email: true,
        bio: true,
        avatarUrl: true,
        role: true,
        skills: true,
        availability: true,
        createdAt: true,
      },
    });

    // Invalidate user profile cache
    await invalidateCacheKey(generateUserCacheKey(id));

    res.json(user);
  }),
);

export default router;
