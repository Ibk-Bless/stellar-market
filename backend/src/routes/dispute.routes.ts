import { Router, Request, Response } from "express";
import { DisputeStatus, UserRole, PrismaClient } from "@prisma/client";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { authenticate, AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";
import { validate } from "../middleware/validation";
import { DisputeService } from "../services/dispute.service";
import { upload, UPLOAD_DIR } from "../config/upload";
import { validateFileMimeType, formatFileSize } from "../utils/fileValidation";
import { config } from "../config";
import {
  confirmDisputeTransactionSchema,
  createDisputeSchema,
  castVoteSchema,
  disputeIdParamSchema,
  initRaiseDisputeSchema,
  queryDisputesSchema,
  resolveDisputeSchema,
  webhookPayloadSchema,
} from "../schemas/dispute";

const prisma = new PrismaClient();

async function verifyAnchorTxOnHorizon(txHash: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${config.stellar.horizonUrl}/transactions/${txHash}`,
    );
    return res.ok;
  } catch {
    return false;
  }
}

const router = Router();

/**
 * GET /api/disputes/history
 * Get user's dispute history (initiated or involved)
 */
router.get(
  "/history",
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      filter = "all",
      sortBy = "recent",
      page = 1,
      limit = 20,
    } = req.query;
    const userId = req.userId!;

    const disputes = await DisputeService.getUserDisputeHistory(
      userId,
      filter as "all" | "initiated" | "involved",
      sortBy as "recent" | "oldest",
      { page: Number(page), limit: Number(limit) },
    );

    res.json(disputes);
  }),
);

/**
 * GET /api/disputes
 * Get all disputes with optional filtering and pagination
 */
router.get(
  "/",
  authenticate,
  validate({ query: queryDisputesSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const query = req.query as unknown as { page: number; limit: number };

    const result = await DisputeService.getDisputes(
      { status: DisputeStatus.OPEN },
      { page: query.page, limit: query.limit },
    );

    const disputes = (result.disputes as any[]).map((dispute: any) => {
      const { walletAddress: _clientWalletAddress, ...client } = dispute.client;
      const { walletAddress: _freelancerWalletAddress, ...freelancer } =
        dispute.freelancer;
      const { walletAddress: _initiatorWalletAddress, ...initiator } =
        dispute.initiator;

      return {
        ...dispute,
        client,
        freelancer,
        initiator,
      };
    });

    // Community listing returns array for frontend compatibility
    res.json(disputes);
  }),
);

/**
 * GET /api/disputes/:id
 * Get specific dispute details
 */
router.get(
  "/:id",
  authenticate,
  validate({ params: disputeIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const dispute = (await DisputeService.getDisputeById(
      req.params.id as string,
    )) as any;

    const userId = req.userId!;
    const isParticipant =
      dispute.clientId === userId ||
      dispute.freelancerId === userId ||
      dispute.initiatorId === userId;

    const isRegisteredVoter = Array.isArray(dispute.votes)
      ? dispute.votes.some((vote: any) => vote.voterId === userId)
      : false;
    const isAdmin = req.userRole === UserRole.ADMIN;

    if (!isParticipant && !isRegisteredVoter && !isAdmin) {
      res.status(403).json({
        error:
          "Access denied. Only dispute participants or registered voters can view this dispute.",
      });
      return;
    }

    res.json(dispute);
  }),
);

/**
 * POST /api/disputes
 * Create a new dispute
 */
router.post(
  "/",
  authenticate,
  validate({ body: createDisputeSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = req.body as { jobId: string; reason: string };

    const dispute = await DisputeService.createDispute(
      data.jobId,
      req.userId!,
      data.reason,
    );

    res.status(201).json(dispute);
  }),
);

/**
 * POST /api/disputes/init-raise
 * Initialize dispute creation (get XDR for signing)
 */
router.post(
  "/init-raise",
  authenticate,
  validate({ body: initRaiseDisputeSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { jobId, reason, minVotes } = req.body;

    const dispute = await DisputeService.initRaiseDispute(
      jobId,
      req.userId!,
      reason,
      minVotes,
    );

    res.json(dispute);
  }),
);

/**
 * POST /api/disputes/confirm-tx
 * Confirm dispute transaction
 */
router.post(
  "/confirm-tx",
  authenticate,
  validate({ body: confirmDisputeTransactionSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { hash, type, jobId, onChainDisputeId, respondentId, reason } =
      req.body;

    const result = await DisputeService.confirmDisputeTransaction(
      hash,
      type,
      jobId,
      onChainDisputeId,
      respondentId,
      reason,
      req.userId!,
    );

    res.json(result);
  }),
);

/**
 * POST /api/disputes/:id/votes
 * Cast a vote on a dispute
 */
router.post(
  "/:id/votes",
  authenticate,
  validate({ params: disputeIdParamSchema, body: castVoteSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const dispute = await DisputeService.getDisputeById(
      req.params.id as string,
    );
    if (!dispute) {
      return res.status(404).json({ error: "Dispute not found." });
    }

    // Conflict-of-interest check: Job participants cannot vote
    if (
      dispute.job.clientId === req.userId ||
      dispute.job.freelancerId === req.userId
    ) {
      return res.status(403).json({
        error:
          "Job participants (client or freelancer) cannot vote on their own dispute.",
      });
    }
    const data = req.body as {
      choice: "CLIENT" | "FREELANCER";
      reason: string;
    };

    const vote = await DisputeService.castVote(
      req.params.id as string,
      req.userId!,
      data.choice,
      data.reason,
    );

    res.status(201).json(vote);
  }),
);

/**
 * PUT /api/disputes/:id/resolve
 * Resolve a dispute (admin only or automated)
 */
router.put(
  "/:id/resolve",
  authenticate,
  validate({ params: disputeIdParamSchema, body: resolveDisputeSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = req.body as { outcome: string };

    const dispute = await DisputeService.resolveDispute(
      req.params.id as string,
      data.outcome,
    );

    res.json(dispute);
  }),
);

/**
 * GET /api/disputes/:id/stats
 * Get vote statistics for a dispute
 */
router.get(
  "/:id/stats",
  validate({ params: disputeIdParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const stats = await DisputeService.getVoteStats(req.params.id as string);
    res.json(stats);
  }),
);

/**
 * POST /api/disputes/webhook
 * Process blockchain webhook events
 */
router.post(
  "/webhook",
  validate({ body: webhookPayloadSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body;

    const result = await DisputeService.processWebhook(payload);

    res.json(result);
  }),
);

/**
 * POST /api/disputes/:id/evidence
 * Upload evidence files for a dispute with optional integrity metadata
 */
router.post(
  "/:id/evidence",
  authenticate,
  validate({ params: disputeIdParamSchema }),
  upload.array("files", 5),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const disputeId = req.params.id as string;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const dispute = await DisputeService.getDisputeById(disputeId);
    if (!dispute) {
      for (const f of files) fs.unlinkSync(f.path);
      return res.status(404).json({ error: "Dispute not found" });
    }

    const isParticipant =
      dispute.clientId === req.userId ||
      dispute.freelancerId === req.userId ||
      dispute.initiatorId === req.userId;

    if (!isParticipant) {
      for (const f of files) fs.unlinkSync(f.path);
      return res.status(403).json({
        error: "Only dispute participants can upload evidence",
      });
    }

    let hashes: string[] = [];
    let anchorTxHashes: string[] = [];
    try {
      hashes = req.body.hashes ? JSON.parse(req.body.hashes) : [];
      anchorTxHashes = req.body.anchorTxHashes
        ? JSON.parse(req.body.anchorTxHashes)
        : [];
    } catch {
      hashes = [];
      anchorTxHashes = [];
    }

    const attachments = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validation = await validateFileMimeType(file.path);

      if (!validation.valid) {
        fs.unlinkSync(file.path);
        continue;
      }

      const serverHash = crypto.createHash("sha256");
      const stream = fs.createReadStream(file.path);
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk) => serverHash.update(chunk));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      const computedSha256 = serverHash.digest("hex");

      const clientSha256 = hashes[i] || null;
      if (clientSha256 && clientSha256 !== computedSha256) {
        fs.unlinkSync(file.path);
        continue;
      }

      const candidateAnchorTx = anchorTxHashes[i] || null;
      if (candidateAnchorTx) {
        const txExists = await verifyAnchorTxOnHorizon(candidateAnchorTx);
        if (!txExists) {
          fs.unlinkSync(file.path);
          continue;
        }
      }

      const attachment = await prisma.attachment.create({
        data: {
          uploaderId: req.userId!,
          disputeId,
          filename: file.filename,
          originalName: file.originalname,
          mimeType: validation.detectedType || file.mimetype,
          size: file.size,
          url: `/api/uploads/${file.filename}`,
          sha256: computedSha256,
          anchorTxHash: candidateAnchorTx,
        },
      });

      attachments.push({
        ...attachment,
        sizeFormatted: formatFileSize(attachment.size),
      });
    }

    res.status(201).json({ attachments });
  }),
);

/**
 * GET /api/disputes/:id/evidence
 * Get all evidence attachments for a dispute with integrity info
 */
router.get(
  "/:id/evidence",
  authenticate,
  validate({ params: disputeIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const disputeId = req.params.id as string;

    const attachments = await prisma.attachment.findMany({
      where: { disputeId },
      include: {
        uploader: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      evidence: attachments.map((att) => ({
        id: att.id,
        fileName: att.originalName,
        fileType: att.mimeType,
        size: att.size,
        sizeFormatted: formatFileSize(att.size),
        sha256: att.sha256,
        anchorTxHash: att.anchorTxHash,
        uploadedAt: att.createdAt.toISOString(),
        uploader: att.uploader,
        url: att.url,
      })),
    });
  }),
);

/**
 * GET /api/disputes/:id/evidence/:evidenceId/verify
 * Re-compute SHA-256 of the stored evidence file and check integrity
 */
router.get(
  "/:id/evidence/:evidenceId/verify",
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const attachment = await prisma.attachment.findFirst({
      where: {
        id: req.params.evidenceId as string,
        disputeId: req.params.id as string,
      },
    });

    if (!attachment) {
      return res.status(404).json({ error: "Evidence not found" });
    }

    if (!attachment.sha256) {
      return res.status(400).json({
        error: "No integrity hash recorded for this evidence",
      });
    }

    const filePath = path.join(UPLOAD_DIR, attachment.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found on server" });
    }

    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const computedHash = hash.digest("hex");
    const intact = computedHash === attachment.sha256;

    res.json({
      intact,
      storedHash: attachment.sha256,
      computedHash,
      anchorTxHash: attachment.anchorTxHash,
      fileName: attachment.originalName,
    });
  }),
);

export default router;
