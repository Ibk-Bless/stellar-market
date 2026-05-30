import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticate, AuthRequest } from "../middleware/auth";
import { validate } from "../middleware/validation";
import { asyncHandler } from "../middleware/error";
import { RecommendationQueueService } from "../services/recommendation-queue.service";
import {
  createJobSchema,
  updateJobSchema,
  getJobsQuerySchema,
  getJobByIdParamSchema,
  updateJobStatusSchema,
  getSavedJobsQuerySchema,
} from "../schemas";
import { paginationSchema } from "../schemas/common";
import {
  cache,
  invalidateCache,
  invalidateCacheKey,
  generateJobsCacheKey,
  generateJobCacheKey,
  generateJobOnChainStatusCacheKey,
} from "../lib/cache";
import {
  ContractService,
  RevisionProposalView,
} from "../services/contract.service";

const router = Router();
/**
 * @swagger
 * tags:
 *   name: Jobs
 *   description: Job management endpoints
 */
const prisma = new PrismaClient();

// Get all jobs with optional filters and pagination
router.get(
  "/",
  /**
   * @swagger
   * /jobs:
   *   get:
   *     summary: Get all jobs with search and filters
   *     tags: [Jobs]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         description: Page number
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Items per page (max 100)
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Full-text search on title and description (uses PostgreSQL tsvector)
   *       - in: query
   *         name: token
   *         schema:
   *           type: string
   *           example: XLM
   *         description: Filter by payment token (e.g. XLM, USDC)
   *       - in: query
   *         name: minBudget
   *         schema:
   *           type: number
   *         description: Minimum budget filter
   *       - in: query
   *         name: maxBudget
   *         schema:
   *           type: number
   *         description: Maximum budget filter
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *         description: Filter by job status (comma-separated for multiple)
   *       - in: query
   *         name: sort
   *         schema:
   *           type: string
   *           enum: [newest, oldest, budget_desc, budget_asc, budget_high, budget_low]
   *         description: Sort order
   *       - in: query
   *         name: cursor
   *         schema:
   *           type: string
   *         description: Cursor for cursor-based pagination
   *     responses:
   *       200:
   *         description: List of jobs
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/JobsResponse'
   */
  /**
   * @swagger
   * /jobs/{id}:
   *   get:
   *     summary: Get job by ID
   *     tags: [Jobs]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Job ID
   *     responses:
   *       200:
   *         description: Job details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/JobResponse'
   *       404:
   *         description: Job not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  validate({ query: getJobsQuerySchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = 1, limit = 20, search, category, skill, skills, status, minBudget, maxBudget, clientId, token, sort, postedAfter, cursor } = (req as any).query;
    // Ensure limit is within bounds
    const safeLimit = Math.min(Math.max(1, Number(limit)), 100);
    const safePage = Math.max(1, Number(page));

    const cacheKey = generateJobsCacheKey({
      page: safePage,
      limit: safeLimit,
      search,
      skill,
      skills,
      category,
      status,
      minBudget,
      maxBudget,
      clientId,
      token,
      sort,
      postedAfter,
      cursor,
    });

    const { data, hit } = await cache(cacheKey, 30, async () => {
      const where: any = {};

      // Full-text search using PostgreSQL tsvector/tsquery with relevance ranking.
      // Falls back to Prisma contains (LIKE) if raw query fails.
      if (search) {
        try {
          const ftsResults = await prisma.$queryRaw<
            { id: string; rank: number }[]
          >`
            SELECT id, ts_rank(
              to_tsvector('english', title || ' ' || description || ' ' || array_to_string(skills, ' ')),
              plainto_tsquery('english', ${search})
            ) AS rank
            FROM "Job"
            WHERE to_tsvector('english', title || ' ' || description || ' ' || array_to_string(skills, ' '))
              @@ plainto_tsquery('english', ${search})
            ORDER BY rank DESC
          `;
          const matchedIds = ftsResults.map((r) => r.id);
          where.id = matchedIds.length > 0 ? { in: matchedIds } : { in: [] };
        } catch {
          // Fallback to plain case-insensitive LIKE search
          const searchTerms = (search as string)
            .split(/\s+/)
            .map((term) => term.trim())
            .filter(Boolean);

          where.OR = [
            { title: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            ...(searchTerms.length > 0 ? [{ skills: { hasSome: searchTerms } }] : []),
          ];
        }
      }

      if (skills) {
        const skillList = (skills as string)
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);
        if (skillList.length === 1) {
          where.skills = { has: skillList[0] };
        } else if (skillList.length > 1) {
          where.skills = { hasSome: skillList };
        }
      } else if (skill) {
        where.skills = { has: skill };
      }

      if (category) {
        where.category = { equals: category, mode: "insensitive" };
      }

      if (status) {
        const statusList = (status as string)
          .split(",")
          .map((s: string) => s.trim());
        if (statusList.length === 1) {
          where.status = statusList[0];
        } else {
          where.status = { in: statusList };
        }
      }

      if (minBudget || maxBudget) {
        where.budget = {};
        if (minBudget) where.budget.gte = Number(minBudget);
        if (maxBudget) where.budget.lte = Number(maxBudget);
      }

      if (clientId) {
        where.clientId = clientId;
      }

      // Filter by payment token (e.g. ?token=XLM)
      if (token) {
        where.paymentToken = { equals: token, mode: "insensitive" };
      }

      if (postedAfter) {
        where.createdAt = { gte: new Date(postedAfter) };
      }

      // Resolve sort — supports legacy names and new aliases
      const resolveOrderBy = (sortParam: string | undefined): any => {
        switch (sortParam) {
          case "oldest":
            return { createdAt: "asc" };
          case "budget_high":
          case "budget_desc":
            return { budget: "desc" };
          case "budget_low":
          case "budget_asc":
            return { budget: "asc" };
          case "created_at":
          case "newest":
          default:
            return { createdAt: "desc" };
        }
      };

      // Cursor-based pagination — preferred when `cursor` is supplied.
      if (cursor) {
        const sortDirection: "asc" | "desc" = sort === "oldest" ? "asc" : "desc";

        let cursorId: string | undefined;
        let cursorCreatedAt: Date | undefined;
        try {
          const decoded = JSON.parse(
            Buffer.from(cursor, "base64").toString("utf8"),
          ) as { id?: string; createdAt?: string };
          cursorId = decoded.id;
          cursorCreatedAt = decoded.createdAt ? new Date(decoded.createdAt) : undefined;
        } catch {
          cursorId = cursor as string;
        }

        if (!cursorId || !cursorCreatedAt || Number.isNaN(cursorCreatedAt.getTime())) {
          const anchor = cursorId
            ? await prisma.job.findUnique({
                where: { id: cursorId },
                select: { id: true, createdAt: true },
              })
            : null;
          if (!anchor) {
            return { data: [], pagination: { total: 0, page: null, limit: safeLimit, hasNext: false, nextCursor: null } };
          }
          cursorId = anchor.id;
          cursorCreatedAt = anchor.createdAt;
        }

        const cursorClause =
          sortDirection === "desc"
            ? {
                OR: [
                  { createdAt: { lt: cursorCreatedAt } },
                  {
                    AND: [
                      { createdAt: cursorCreatedAt },
                      { id: { lt: cursorId } },
                    ],
                  },
                ],
              }
            : {
                OR: [
                  { createdAt: { gt: cursorCreatedAt } },
                  {
                    AND: [
                      { createdAt: cursorCreatedAt },
                      { id: { gt: cursorId } },
                    ],
                  },
                ],
              };

        const paginatedWhere: any = { ...where };
        paginatedWhere.AND = Array.isArray(where.AND)
          ? [...where.AND, cursorClause]
          : [cursorClause];

        const orderBy: any = [
          { createdAt: sortDirection },
          { id: sortDirection },
        ];

        const jobs = await prisma.job.findMany({
          where: paginatedWhere,
          include: {
            client: { select: { id: true, username: true, avatarUrl: true } },
            freelancer: {
              select: { id: true, username: true, avatarUrl: true },
            },
            milestones: true,
            _count: { select: { applications: true } },
          },
          orderBy,
          take: safeLimit + 1,
        });

        const hasMore = jobs.length > safeLimit;
        const pageData = hasMore ? jobs.slice(0, safeLimit) : jobs;
        const lastJob = pageData[pageData.length - 1];
        const nextCursor =
          hasMore && lastJob
            ? Buffer.from(
                JSON.stringify({
                  id: lastJob.id,
                  createdAt: lastJob.createdAt,
                }),
              ).toString("base64")
            : null;

        const total = await prisma.job.count({ where });

        return {
          data: pageData,
          pagination: {
            total,
            page: null,
            limit: safeLimit,
            hasNext: hasMore,
            nextCursor,
          },
        };
      }

      // Offset-based pagination
      const skip = (safePage - 1) * safeLimit;
      const orderBy = resolveOrderBy(sort);

      const [jobs, total] = await Promise.all([
        prisma.job.findMany({
          where,
          include: {
            client: { select: { id: true, username: true, avatarUrl: true } },
            freelancer: {
              select: { id: true, username: true, avatarUrl: true },
            },
            milestones: true,
            _count: { select: { applications: true } },
          },
          orderBy,
          skip,
          take: safeLimit,
        }),
        prisma.job.count({ where }),
      ]);

      const totalPages = Math.ceil(total / safeLimit);
      const hasNext = safePage < totalPages;
      const lastJob = jobs[jobs.length - 1];
      const nextCursor = lastJob
        ? Buffer.from(
            JSON.stringify({ id: lastJob.id, createdAt: lastJob.createdAt }),
          ).toString("base64")
        : null;

      return {
        data: jobs,
        pagination: {
          total,
          page: safePage,
          limit: safeLimit,
          totalPages,
          hasNext,
          nextCursor,
        },
      };
    });

    res.set("X-Cache-Hit", hit.toString());
    res.json(data);
  }),
);

// Get jobs for the authenticated user (client or freelancer)
router.get(
  "/mine",
  authenticate,
  validate({ query: paginationSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page = 1, limit = 20, status } = req.query as any;

    // Ensure limit is within bounds
    const safeLimit = Math.min(Math.max(1, Number(limit)), 100);
    const safePage = Math.max(1, Number(page));
    const skip = (safePage - 1) * safeLimit;

    const where: any = {
      OR: [{ clientId: req.userId }, { freelancerId: req.userId }],
      deletedAt: null,
    };
    if (status) where.status = status;

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: { createdAt: "desc" },
        include: {
          client: { select: { id: true, username: true, avatarUrl: true } },
          freelancer: { select: { id: true, username: true, avatarUrl: true } },
          milestones: true,
          _count: { select: { applications: true } },
        },
      }),
      prisma.job.count({ where }),
    ]);

    const totalPages = Math.ceil(total / safeLimit);
    const hasNext = safePage < totalPages;

    res.json({
      data: jobs,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
        hasNext,
      },
    });
  }),
);

// Get saved jobs for authenticated freelancer
router.get(
  "/saved",
  authenticate,
  validate({ query: getSavedJobsQuerySchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    });

    if (!user || user.role !== "FREELANCER") {
      return res
        .status(403)
        .json({ error: "Only freelancers can view saved jobs." });
    }

    const {
      page = 1,
      limit = 20,
      search,
      category,
      skill,
      minBudget,
      maxBudget,
    } = req.query as any;

    // Ensure limit is within bounds
    const safeLimit = Math.min(Math.max(1, Number(limit)), 100);
    const safePage = Math.max(1, Number(page));
    const skip = (safePage - 1) * safeLimit;

    const jobWhere: any = {
      status: "OPEN",
      deletedAt: null,
    };

    if (search) {
      jobWhere.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (skill) {
      jobWhere.skills = { has: skill };
    }

    if (category) {
      jobWhere.category = { equals: category, mode: "insensitive" };
    }

    if (minBudget || maxBudget) {
      jobWhere.budget = {};
      if (minBudget) jobWhere.budget.gte = Number(minBudget);
      if (maxBudget) jobWhere.budget.lte = Number(maxBudget);
    }

    const savedJobWhere: any = {
      freelancerId: req.userId,
      job: jobWhere,
    };

    const [savedJobs, total] = await Promise.all([
      prisma.savedJob.findMany({
        where: savedJobWhere,
        include: {
          job: {
            include: {
              client: { select: { id: true, username: true, avatarUrl: true } },
              milestones: true,
              _count: { select: { applications: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: safeLimit,
      }),
      prisma.savedJob.count({
        where: savedJobWhere,
      }),
    ]);

    const jobs = savedJobs.map((savedJob) => ({
      ...savedJob.job,
      savedAt: savedJob.createdAt,
      isSaved: true,
    }));

    const totalPages = Math.ceil(total / safeLimit);
    const hasNext = safePage < totalPages;

    res.json({
      data: jobs,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
        hasNext,
      },
    });
  }),
);

// Get a single job by ID
	router.get(
	  "/:id",
	  validate({ params: getJobByIdParamSchema }),
	  asyncHandler(async (req: AuthRequest, res: Response) => {
	    const id = req.params.id as string;
	    const job = await prisma.job.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        client: {
          select: { id: true, username: true, avatarUrl: true, bio: true },
        },
        freelancer: {
          select: { id: true, username: true, avatarUrl: true, bio: true },
        },
        milestones: { orderBy: { order: "asc" } },
        applications: {
          include: {
            freelancer: {
              select: { id: true, username: true, avatarUrl: true },
            },
          },
        },
      },
    });

	    if (!job) {
	      return res.status(404).json({ error: "Job not found." });
	    }

	    const lastModified = (job as any).updatedAt ?? (job as any).createdAt;
	    const etag = `W/"job:${id}:${new Date(lastModified).toISOString()}"`;
	    res.setHeader("ETag", etag);
	    res.setHeader("Last-Modified", new Date(lastModified).toUTCString());
	    if (!req.userId && req.headers["if-none-match"] === etag) {
	      return res.status(304).end();
	    }

	    let isSaved = false;
	    if (req.userId) {
	      const user = await prisma.user.findUnique({
	        where: { id: req.userId },
        select: { role: true },
      });

      if (user && user.role === "FREELANCER") {
        const savedJob = await prisma.savedJob.findUnique({
          where: {
            freelancerId_jobId: {
              freelancerId: req.userId,
              jobId: id,
            },
          },
        });
        isSaved = !!savedJob;
      }
    }

    let escrowStatus = job.escrowStatus as string;
    let revisionProposal: RevisionProposalView | null = null;

    if (job.contractJobId) {
      try {
        const cacheKey = generateJobOnChainStatusCacheKey(id);
        const { data: onChainStatus } = await cache(cacheKey, 30, async () => {
          return await ContractService.getOnChainJobStatus(job.contractJobId!);
        });
        escrowStatus = onChainStatus;
      } catch (error) {
        console.warn(
          `Could not fetch on-chain status for job ${id}, falling back to DB:`,
          error,
        );
      }

      try {
        const p = await ContractService.getRevisionProposal(job.contractJobId);
        revisionProposal = p && p.status === "PENDING" ? p : null;
      } catch (error) {
        console.warn(`Could not fetch revision proposal for job ${id}:`, error);
      }
    }

    res.json({
      ...job,
      escrow_status: escrowStatus,
      escrowStatus: escrowStatus,
      revisionProposal,
      isSaved,
    });
  }),
);

// Create a new job
router.post(
  "/",
  /**
   * @swagger
   * /jobs:
   *   post:
   *     summary: Create a new job
   *     tags: [Jobs]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateJobRequest'
   *           examples:
   *             example:
   *               value:
   *                 title: Sample Job
   *                 description: Job description...
   *                 budget: 1000
   *                 skills: ["React", "Node.js"]
   *                 deadline: "2026-03-01T00:00:00Z"
   *                 category: Development
   *     responses:
   *       201:
   *         description: Job created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/JobResponse'
   *       400:
   *         description: Invalid input
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  authenticate,
  validate({ body: createJobSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    });

    if (!user || user.role !== "CLIENT") {
      return res.status(403).json({ error: "Only clients can post jobs." });
    }

    const { title, description, budget, skills, deadline } = req.body;

    const job = await prisma.job.create({
      data: {
        title,
        description,
        budget,
        category: req.body.category || "General",
        skills,
        deadline: new Date(deadline),
        clientId: req.userId!,
      },
      include: {
        milestones: true,
        client: { select: { id: true, username: true, avatarUrl: true } },
        _count: { select: { applications: true } },
      },
    });

    await invalidateCache("jobs:list:*");
    void RecommendationQueueService.enqueueRebuild(job.id);

    try {
      const { getIo } = await import("../socket");
      const io = getIo();
      io.emit("job:created", job);
    } catch {
      // Socket not initialized (e.g., in tests)
    }

    res.status(201).json(job);
  }),
);

// Update a job
router.put(
  "/:id",
  authenticate,
  validate({
    params: getJobByIdParamSchema,
    body: updateJobSchema,
  }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const job = await prisma.job.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    if (job.clientId !== req.userId) {
      return res
        .status(403)
        .json({ error: "Not authorized to update this job." });
    }

    const updateData = req.body;
    if (updateData.deadline) {
      updateData.deadline = new Date(updateData.deadline);
    }

    const updated = await prisma.job.update({
      where: { id },
      data: updateData,
      include: { milestones: true },
    });

    await invalidateCache("jobs:list:*");
    await invalidateCacheKey(generateJobCacheKey(id));
    void RecommendationQueueService.enqueueRebuild(id);

    res.json(updated);
  }),
);

// Delete a job (soft delete)
router.delete(
  "/:id",
  authenticate,
  validate({ params: getJobByIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const job = await prisma.job.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    if (job.clientId !== req.userId) {
      return res
        .status(403)
        .json({ error: "Not authorized to delete this job." });
    }

    await prisma.job.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await invalidateCache("jobs:list:*");
    await invalidateCacheKey(generateJobCacheKey(id));
    void RecommendationQueueService.enqueueRebuild(id);

    res.json({ message: "Job deleted successfully." });
  }),
);

// Update job status
router.patch(
  "/:id/status",
  authenticate,
  validate({
    params: getJobByIdParamSchema,
    body: updateJobStatusSchema,
  }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { status } = req.body;

    const job = await prisma.job.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    if (job.clientId !== req.userId) {
      return res
        .status(403)
        .json({ error: "Not authorized to update this job." });
    }

    const updated = await prisma.job.update({
      where: { id },
      data: { status },
      include: { milestones: true },
    });

    await invalidateCache("jobs:list:*");
    await invalidateCacheKey(generateJobCacheKey(id));
    void RecommendationQueueService.enqueueRebuild(id);

    res.json(updated);
  }),
);

// Complete a job (client only)
router.patch(
  "/:id/complete",
  authenticate,
  validate({ params: getJobByIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    const job = await prisma.job.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: { milestones: true, freelancer: true },
    });

    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    if (job.clientId !== req.userId) {
      return res
        .status(403)
        .json({ error: "Only the client can mark the job as complete." });
    }

    const allApproved = job.milestones.every((m) => m.status === "APPROVED");
    if (!allApproved) {
      return res.status(400).json({
        error: "All milestones must be approved before completing the job.",
      });
    }

    const updated = await prisma.job.update({
      where: { id },
      data: { status: "COMPLETED" },
      include: { milestones: true, client: true, freelancer: true },
    });

    const { NotificationService } =
      await import("../services/notification.service");

    if (job.freelancerId) {
      await NotificationService.sendNotification({
        userId: job.freelancerId,
        type: "MILESTONE_APPROVED",
        title: "Job Completed",
        message: `The client has marked "${job.title}" as complete. Please leave a review!`,
        metadata: { jobId: id },
      });
    }

    const { getIo } = await import("../socket");
    const io = getIo();
    io.to(`user:${job.clientId}`).emit("job:completed", { jobId: id });
    if (job.freelancerId) {
      io.to(`user:${job.freelancerId}`).emit("job:completed", { jobId: id });
    }

    await invalidateCache("jobs:list:*");
    await invalidateCacheKey(generateJobCacheKey(id));
    void RecommendationQueueService.enqueueRebuild(id);

    res.json(updated);
  }),
);

// Save/bookmark a job
router.post(
  "/:id/save",
  authenticate,
  validate({ params: getJobByIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    });

    if (!user || user.role !== "FREELANCER") {
      return res.status(403).json({ error: "Only freelancers can save jobs." });
    }

    const id = req.params.id as string;
    const job = await prisma.job.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }

    const existingSave = await prisma.savedJob.findUnique({
      where: {
        freelancerId_jobId: {
          freelancerId: req.userId!,
          jobId: id,
        },
      },
    });

    if (existingSave) {
      return res.status(409).json({ error: "Job already saved." });
    }

    const savedJob = await prisma.savedJob.create({
      data: {
        freelancerId: req.userId!,
        jobId: id,
      },
    });

    res.status(201).json({
      message: "Job saved successfully.",
      savedJob,
    });
  }),
);

// Remove saved/bookmarked job
router.delete(
  "/:id/save",
  authenticate,
  validate({ params: getJobByIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    });

    if (!user || user.role !== "FREELANCER") {
      return res
        .status(403)
        .json({ error: "Only freelancers can unsave jobs." });
    }

    const id = req.params.id as string;

    const savedJob = await prisma.savedJob.findUnique({
      where: {
        freelancerId_jobId: {
          freelancerId: req.userId!,
          jobId: id,
        },
      },
    });

    if (!savedJob) {
      return res.status(404).json({ error: "Job was not saved." });
    }

    await prisma.savedJob.delete({
      where: {
        freelancerId_jobId: {
          freelancerId: req.userId!,
          jobId: id,
        },
      },
    });

    res.json({ message: "Job unsaved successfully." });
  }),
);

export default router;
