import express, { Router, Request, Response } from "express";
import { DisputeStatus, UserRole, PrismaClient, DisputeEventType } from "@prisma/client";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { authenticate, AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";
import { validate } from "../middleware/validation";
import { DisputeService } from "../services/dispute.service";
import { recordDisputeEvent } from "../services/dispute-event.service";
import { disputeEmitter } from "../lib/dispute-emitter";
import type { DisputeEvent } from "@prisma/client";
import { upload, UPLOAD_DIR } from "../config/upload";
import { validateFileMimeType, formatFileSize } from "../utils/fileValidation";
import { config, MAX_PAGE_SIZE } from "../config";
import {
  createEvidenceDownloadUrl,
  isEvidenceStorageConfigured,
  readEvidenceObject,
  uploadEvidenceObject,
} from "../services/evidence-storage.service";
import {
  confirmDisputeTransactionSchema,
  createDisputeSchema,
  castVoteSchema,
  disputeIdParamSchema,
  initRaiseDisputeSchema,
  queryDisputesSchema,
  resolveDisputeSchema,
  webhookPayloadSchema,
  initiateEvidenceSessionSchema,
  evidenceSessionParamSchema,
  evidenceChunkParamSchema,
} from "../schemas/dispute";
import {
  assembleAndVerify,
  cleanupSession,
  getReceivedChunks,
  getSession,
  initiateSession,
  MAX_CHUNK_SIZE,
  saveChunk,
  validateInitiateInput,
} from "../services/evidence-upload-session.service";

const prisma = new PrismaClient();

async function assertDisputeViewerAccess(
  disputeId: string,
  userId: string,
  userRole: UserRole | undefined,
): Promise<{ allowed: true } | { allowed: false; status: number; error: string }> {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      votes: { where: { voterId: userId }, select: { id: true } },
    },
  });

  if (!dispute) {
    return { allowed: false, status: 404, error: "Dispute not found." };
  }

  const isParticipant =
    dispute.clientId === userId ||
    dispute.freelancerId === userId ||
    dispute.initiatorId === userId;
  const isRegisteredVoter = dispute.votes.length > 0;
  const isAdmin = userRole === UserRole.ADMIN;

  if (!isParticipant && !isRegisteredVoter && !isAdmin) {
    return {
      allowed: false,
      status: 403,
      error:
        "Access denied. Only dispute participants or registered voters can view this dispute.",
    };
  }

  return { allowed: true };
}

/**
 * Evidence upload is participant-only (client / freelancer / initiator), unlike
 * viewing which also admits registered voters and admins.
 */
async function assertDisputeParticipant(
  disputeId: string,
  userId: string,
): Promise<
  | { allowed: true }
  | { allowed: false; status: number; error: string }
> {
  const dispute = await DisputeService.getDisputeById(disputeId);
  if (!dispute) {
    return { allowed: false, status: 404, error: "Dispute not found" };
  }
  const isParticipant =
    dispute.clientId === userId ||
    dispute.freelancerId === userId ||
    dispute.initiatorId === userId;
  if (!isParticipant) {
    return {
      allowed: false,
      status: 403,
      error: "Only dispute participants can upload evidence",
    };
  }
  return { allowed: true };
}

function writeSseEvent(res: Response, event: DisputeEvent): void {
  res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
}

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

    const rawLimit = Number(limit);
    const rawPage = Number(page);
    if (!Number.isFinite(rawLimit) || rawLimit < 1) {
      return res.status(400).json({ error: "limit must be a positive integer" });
    }
    const safeLimit = Math.min(rawLimit, MAX_PAGE_SIZE);
    const safePage = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);

    const disputes = await DisputeService.getUserDisputeHistory(
      userId,
      filter as "all" | "initiated" | "involved",
      sortBy as "recent" | "oldest",
      { page: safePage, limit: safeLimit },
    );

    res.setHeader("X-Max-Page-Size", String(MAX_PAGE_SIZE));
    res.json(disputes);
  }),
);

/**
 * GET /api/disputes
 * Get disputes scoped to the requesting user's role.
 * Freelancers see their own disputes; clients see theirs; admins see all.
 */
router.get(
  "/",
  authenticate,
  validate({ query: queryDisputesSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const query = req.query as unknown as { page: number; limit: number };
    const userId = req.userId!;
    const role = req.userRole;

    let userFilter: Record<string, unknown> | undefined;

    if (role === UserRole.FREELANCER) {
      userFilter = { freelancerId: userId };
    } else if (role === UserRole.CLIENT) {
      userFilter = { clientId: userId };
    } else if (role === UserRole.ADMIN) {
      userFilter = undefined;
    } else {
      res.status(403).json({ error: "Access denied." });
      return;
    }

    const result = await DisputeService.getDisputes(
      { status: DisputeStatus.OPEN, userFilter },
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
    res.setHeader("X-Max-Page-Size", String(MAX_PAGE_SIZE));
    res.json(disputes);
  }),
);

/**
 * GET /api/disputes/:id/stream
 * Server-Sent Events stream for dispute timeline updates
 */
router.get(
  "/:id/stream",
  authenticate,
  validate({ params: disputeIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const disputeId = req.params.id as string;
    const access = await assertDisputeViewerAccess(
      disputeId,
      req.userId!,
      req.userRole,
    );

    if (!access.allowed) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const lastEventHeader = req.headers["last-event-id"];
    const lastEventId = Number(
      Array.isArray(lastEventHeader) ? lastEventHeader[0] : lastEventHeader ?? "0",
    );
    const cursor = Number.isFinite(lastEventId) && lastEventId >= 0 ? lastEventId : 0;

    const backfill = await prisma.disputeEvent.findMany({
      where: { disputeId, id: { gt: cursor } },
      orderBy: { id: "asc" },
    });

    for (const event of backfill) {
      writeSseEvent(res, event);
    }

    const listener = (event: DisputeEvent) => {
      writeSseEvent(res, event);
    };

    disputeEmitter.on(`dispute:${disputeId}`, listener);

    const keepAlive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      disputeEmitter.off(`dispute:${disputeId}`, listener);
    });
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
    const isAdmin = req.userRole === UserRole.ADMIN;
    const dispute = (await DisputeService.getDisputeById(
      req.params.id as string,
      isAdmin,
    )) as any;

    const userId = req.userId!;
    const isParticipant =
      dispute.clientId === userId ||
      dispute.freelancerId === userId ||
      dispute.initiatorId === userId;

    if (!isParticipant && !isAdmin) {
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
 * GET /api/disputes/:id/votes
 * Get paginated votes for a dispute (audit trail)
 */
router.get(
  "/:id/votes",
  authenticate,
  validate({ params: disputeIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const disputeId = req.params.id as string;
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const dispute = await DisputeService.getDisputeById(disputeId);
    if (!dispute) {
      res.status(404).json({ error: "Dispute not found." });
      return;
    }

    const isAdmin = req.userRole === UserRole.ADMIN;
    const isParticipant =
      dispute.clientId === req.userId ||
      dispute.freelancerId === req.userId ||
      dispute.initiatorId === req.userId;

    if (!isParticipant && !isAdmin) {
      res.status(403).json({
        error: "Access denied. Only dispute participants can view vote history.",
      });
      return;
    }

    const result = await DisputeService.getVotesByDisputeId(disputeId, cursor, limit);
    res.json(result);
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
  // In a real app we'd parse rawBody. For now, assume req.body is what we sign.
  validate({ body: webhookPayloadSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers["x-stellar-signature"];
    if (!signature || typeof signature !== "string") {
      return res.status(401).json({ error: "Missing signature" });
    }
    const secret = process.env.WEBHOOK_SECRET || "default_secret";
    const computedSignature = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");
      
    if (signature.length !== computedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
      return res.status(401).json({ error: "Invalid signature" });
    }
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

    if (!isEvidenceStorageConfigured()) {
      for (const f of files) fs.unlinkSync(f.path);
      return res
        .status(503)
        .json({ error: "Evidence S3 storage is not configured" });
    }

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

      const storageKey = `disputes/${disputeId}/${file.filename}`;
      try {
        await uploadEvidenceObject({
          key: storageKey,
          filePath: file.path,
          contentType: validation.detectedType || file.mimetype,
        });
      } finally {
        // Files are only staged on disk while validating and uploading them.
        fs.unlinkSync(file.path);
      }

      const attachment = await prisma.attachment.create({
        data: {
          uploaderId: req.userId!,
          disputeId,
          filename: storageKey,
          originalName: file.originalname,
          mimeType: validation.detectedType || file.mimetype,
          size: file.size,
          // This is an object identifier, never a publicly usable file URL.
          url: `s3://${config.evidenceStorage.bucket}/${storageKey}`,
          sha256: computedSha256,
          anchorTxHash: candidateAnchorTx,
        },
      });

      attachments.push({
        ...attachment,
        sizeFormatted: formatFileSize(attachment.size),
      });
    }

    if (attachments.length > 0) {
      await recordDisputeEvent(disputeId, DisputeEventType.EVIDENCE_SUBMITTED, {
        fileCount: attachments.length,
        uploaderId: req.userId,
      });
    }

    res.status(201).json({ attachments });
  }),
);

/**
 * Resumable / chunked evidence upload protocol.
 *
 * The whole multi-file batch is no longer one all-or-nothing request. Each file
 * gets its own upload session (initiate -> upload parts -> complete), keyed
 * deterministically by (dispute, uploader, file hash). A dropped connection
 * therefore discards only the in-flight chunks of one file; already-completed
 * files and already-received chunks are not re-sent. The assembled file's
 * SHA-256 is recomputed server-side and must match the client-declared hash.
 */

/**
 * POST /api/disputes/:id/evidence/sessions
 * Initiate (or resume) a chunked upload session. Returns the stable sessionId
 * and the set of chunk indexes already received, so the client can skip them.
 */
router.post(
  "/:id/evidence/sessions",
  authenticate,
  validate({ params: disputeIdParamSchema, body: initiateEvidenceSessionSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const disputeId = req.params.id as string;

    if (!isEvidenceStorageConfigured()) {
      return res
        .status(503)
        .json({ error: "Evidence S3 storage is not configured" });
    }

    const access = await assertDisputeParticipant(disputeId, req.userId!);
    if (!access.allowed) {
      return res.status(access.status).json({ error: access.error });
    }

    const body = req.body as {
      originalName: string;
      sha256: string;
      size: number;
      mimeType: string;
      chunkSize: number;
      totalChunks: number;
      anchorTxHash?: string | null;
    };

    const reason = validateInitiateInput({
      size: body.size,
      chunkSize: body.chunkSize,
      totalChunks: body.totalChunks,
      sha256: body.sha256,
    });
    if (reason) {
      return res.status(400).json({ error: reason });
    }

    const { sessionId, manifest, receivedChunks } = initiateSession({
      disputeId,
      uploaderId: req.userId!,
      originalName: body.originalName,
      sha256: body.sha256,
      size: body.size,
      mimeType: body.mimeType,
      chunkSize: body.chunkSize,
      totalChunks: body.totalChunks,
      anchorTxHash: body.anchorTxHash ?? null,
      createdAt: new Date().toISOString(),
    });

    res.status(200).json({
      sessionId,
      totalChunks: manifest.totalChunks,
      receivedChunks,
    });
  }),
);

/**
 * GET /api/disputes/:id/evidence/sessions/:sessionId
 * Status of an in-flight session (which chunks are already on the server).
 */
router.get(
  "/:id/evidence/sessions/:sessionId",
  authenticate,
  validate({ params: evidenceSessionParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { sessionId } = req.params as unknown as { sessionId: string };
    const manifest = getSession(sessionId);
    if (!manifest) {
      return res.status(404).json({ error: "Upload session not found" });
    }
    return res.status(200).json({
      sessionId,
      totalChunks: manifest.totalChunks,
      receivedChunks: getReceivedChunks(sessionId),
    });
  }),
);

/**
 * PUT /api/disputes/:id/evidence/sessions/:sessionId/chunks/:index
 * Upload a single chunk (raw binary body). Idempotent: re-sending an already
 * received chunk is accepted and is a no-op.
 */
router.put(
  "/:id/evidence/sessions/:sessionId/chunks/:index",
  authenticate,
  validate({ params: evidenceChunkParamSchema }),
  express.raw({ type: "application/octet-stream", limit: MAX_CHUNK_SIZE + 1024 }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { sessionId, index } = req.params as unknown as {
      sessionId: string;
      index: string;
    };

    const manifest = getSession(sessionId);
    if (!manifest) {
      return res.status(404).json({ error: "Upload session not found" });
    }

    const access = await assertDisputeParticipant(
      manifest.disputeId,
      req.userId!,
    );
    if (!access.allowed) {
      return res.status(access.status).json({ error: access.error });
    }

    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: "Chunk body is required" });
    }

    let receivedChunks: number[];
    try {
      ({ receivedChunks } = saveChunk(sessionId, Number(index), req.body));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to store chunk";
      return res.status(400).json({ error: message });
    }

    return res.status(200).json({ sessionId, index: Number(index), receivedChunks });
  }),
);

/**
 * POST /api/disputes/:id/evidence/sessions/:sessionId/complete
 * Assemble the chunks, verify the SHA-256, validate MIME type, store to S3, and
 * record the attachment. Aborts the session on hash mismatch or validation
 * failure so a corrupted resume can never be recorded as intact.
 */
router.post(
  "/:id/evidence/sessions/:sessionId/complete",
  authenticate,
  validate({ params: evidenceSessionParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { sessionId } = req.params as unknown as { sessionId: string };
    const manifest = getSession(sessionId);
    if (!manifest) {
      return res.status(404).json({ error: "Upload session not found" });
    }

    const access = await assertDisputeParticipant(
      manifest.disputeId,
      req.userId!,
    );
    if (!access.allowed) {
      return res.status(access.status).json({ error: access.error });
    }

    let assembled;
    try {
      assembled = assembleAndVerify(sessionId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to assemble file";
      return res.status(400).json({ error: message });
    }

    if (!assembled.verified) {
      cleanupSession(sessionId);
      return res.status(422).json({
        error:
          "Integrity check failed: server-computed hash does not match the declared hash",
        computedSha256: assembled.computedSha256,
        declaredSha256: manifest.sha256,
      });
    }

    const validation = await validateFileMimeType(assembled.filePath);
    if (!validation.valid) {
      cleanupSession(sessionId);
      return res.status(415).json({
        error: validation.error || "Unsupported file type",
      });
    }

    const storageKey = `disputes/${manifest.disputeId}/${sessionId}`;
    try {
      await uploadEvidenceObject({
        key: storageKey,
        filePath: assembled.filePath,
        contentType: validation.detectedType || manifest.mimeType,
      });
    } finally {
      // The assembled file exists only while validating + uploading it.
      cleanupSession(sessionId);
    }

    const candidateAnchorTx = manifest.anchorTxHash || null;
    if (candidateAnchorTx) {
      const txExists = await verifyAnchorTxOnHorizon(candidateAnchorTx);
      if (!txExists) {
        return res.status(422).json({ error: "Anchor transaction not found" });
      }
    }

    const attachment = await prisma.attachment.create({
      data: {
        uploaderId: req.userId!,
        disputeId: manifest.disputeId,
        filename: storageKey,
        originalName: manifest.originalName,
        mimeType: validation.detectedType || manifest.mimeType,
        size: manifest.size,
        url: `s3://${config.evidenceStorage.bucket}/${storageKey}`,
        sha256: assembled.computedSha256,
        anchorTxHash: candidateAnchorTx,
      },
    });

    await recordDisputeEvent(
      manifest.disputeId,
      DisputeEventType.EVIDENCE_SUBMITTED,
      { fileCount: 1, uploaderId: req.userId, originalName: manifest.originalName },
    );

    return res.status(201).json({
      attachment: {
        ...attachment,
        sizeFormatted: formatFileSize(attachment.size),
      },
    });
  }),
);

/**
 * DELETE /api/disputes/:id/evidence/sessions/:sessionId
 * Abort an in-flight session and discard its partial chunks.
 */
router.delete(
  "/:id/evidence/sessions/:sessionId",
  authenticate,
  validate({ params: evidenceSessionParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { sessionId } = req.params as unknown as { sessionId: string };
    const manifest = getSession(sessionId);
    if (!manifest) {
      return res.status(404).json({ error: "Upload session not found" });
    }
    const access = await assertDisputeParticipant(
      manifest.disputeId,
      req.userId!,
    );
    if (!access.allowed) {
      return res.status(access.status).json({ error: access.error });
    }
    cleanupSession(sessionId);
    return res.status(200).json({ sessionId, aborted: true });
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
 * GET /api/disputes/:id/evidence/:evidenceId/download
 * Redirect an authorised reviewer to a private, one-minute S3 download URL.
 */
router.get(
  "/:id/evidence/:evidenceId/download",
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const attachment = await prisma.attachment.findFirst({
      where: {
        id: req.params.evidenceId as string,
        disputeId: req.params.id as string,
      },
      include: {
        dispute: {
          include: {
            votes: { where: { voterId: req.userId }, select: { id: true } },
          },
        },
      },
    });

    if (!attachment || !attachment.dispute) {
      return res.status(404).json({ error: "Evidence not found" });
    }

    const dispute = attachment.dispute;
    const canReview =
      dispute.clientId === req.userId ||
      dispute.freelancerId === req.userId ||
      dispute.initiatorId === req.userId ||
      dispute.votes.length > 0 ||
      req.userRole === UserRole.ADMIN;
    if (!canReview) {
      return res.status(403).json({ error: "Access denied" });
    }

    try {
      const url = await createEvidenceDownloadUrl({
        key: attachment.filename,
        filename: attachment.originalName,
        contentType: attachment.mimeType,
      });
      return res.redirect(302, url);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Evidence S3 storage is not configured"
      ) {
        return res.status(503).json({ error: error.message });
      }
      throw error;
    }
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

    const hash = crypto.createHash("sha256");
    if (attachment.filename.startsWith("disputes/")) {
      try {
        hash.update(await readEvidenceObject(attachment.filename));
      } catch {
        return res
          .status(404)
          .json({ error: "File not found in evidence storage" });
      }
    } else {
      // Legacy evidence uploaded before private S3 storage remains verifiable.
      const filePath = path.join(UPLOAD_DIR, attachment.filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found on server" });
      }
      const stream = fs.createReadStream(filePath);
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
    }

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

/**
 * GET /api/disputes/:id/tally
 * Get current vote tally for a dispute
 */
router.get(
  "/:id/tally",
  authenticate,
  validate({ params: disputeIdParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const disputeId = req.params.id as string;

    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        votes: {
          include: {
            voter: {
              select: {
                id: true,
                username: true,
                walletAddress: true,
              },
            },
          },
        },
      },
    });

    if (!dispute) {
      res.status(404).json({ error: "Dispute not found" });
      return;
    }

    const totalVotes = dispute.votes.length;
    const votesForClient = dispute.votes.filter(
      (v) => v.choice === "CLIENT",
    ).length;
    const votesForFreelancer = dispute.votes.filter(
      (v) => v.choice === "FREELANCER",
    ).length;

    const clientPercentage =
      totalVotes > 0 ? (votesForClient / totalVotes) * 100 : 0;
    const freelancerPercentage =
      totalVotes > 0 ? (votesForFreelancer / totalVotes) * 100 : 0;

    const tally = {
      disputeId: dispute.id,
      totalVotes,
      votesForClient,
      votesForFreelancer,
      clientPercentage,
      freelancerPercentage,
      status: dispute.status,
      // Only include individual votes if dispute is resolved
      votes:
        dispute.status === DisputeStatus.RESOLVED
          ? dispute.votes.map((v) => ({
              voterId: v.voter.id,
              voterName: v.voter.username,
              choice: v.choice,
              timestamp: v.createdAt.toISOString(),
            }))
          : undefined,
    };

    res.json(tally);
  }),
);

export default router;
