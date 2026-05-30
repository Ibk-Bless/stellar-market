import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";
import { validate } from "../middleware/validation";
import { DeadlineExtensionService } from "../services/deadline-extension.service";
import { z } from "zod";

const router = Router();

// Validation schemas
const requestExtensionSchema = z.object({
  milestoneId: z.string().min(1),
  jobId: z.string().min(1),
  newDeadline: z.string().datetime(),
  reason: z.string().min(10).max(500),
});

const approveExtensionSchema = z.object({
  extensionRequestId: z.string().min(1),
});

const rejectExtensionSchema = z.object({
  extensionRequestId: z.string().min(1),
  rejectionReason: z.string().min(5).max(500),
});

const confirmExtensionSchema = z.object({
  extensionRequestId: z.string().min(1),
  txHash: z.string().min(1),
});

/**
 * POST /api/deadline-extensions/request
 * Request a deadline extension
 */
router.post(
  "/request",
  authenticate,
  validate({ body: requestExtensionSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { milestoneId, jobId, newDeadline, reason } = req.body;

    const extensionRequest = await DeadlineExtensionService.requestExtension(
      milestoneId,
      jobId,
      req.userId!,
      new Date(newDeadline),
      reason,
    );

    res.status(201).json(extensionRequest);
  }),
);

/**
 * POST /api/deadline-extensions/:id/approve
 * Approve a deadline extension request
 */
router.post(
  "/:id/approve",
  authenticate,
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const extensionRequest = await DeadlineExtensionService.approveExtension(
      req.params.id,
      req.userId!,
    );

    res.json(extensionRequest);
  }),
);

/**
 * POST /api/deadline-extensions/:id/reject
 * Reject a deadline extension request
 */
router.post(
  "/:id/reject",
  authenticate,
  validate({
    body: rejectExtensionSchema,
    params: z.object({ id: z.string() }),
  }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { rejectionReason } = req.body;

    const extensionRequest = await DeadlineExtensionService.rejectExtension(
      req.params.id,
      req.userId!,
      rejectionReason,
    );

    res.json(extensionRequest);
  }),
);

/**
 * POST /api/deadline-extensions/:id/confirm-tx
 * Confirm the on-chain deadline extension transaction
 */
router.post(
  "/:id/confirm-tx",
  authenticate,
  validate({
    body: confirmExtensionSchema,
    params: z.object({ id: z.string() }),
  }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { txHash } = req.body;

    const extensionRequest =
      await DeadlineExtensionService.confirmExtensionTransaction(
        req.params.id,
        txHash,
      );

    res.json(extensionRequest);
  }),
);

/**
 * GET /api/deadline-extensions/job/:jobId
 * Get all extension requests for a job
 */
router.get(
  "/job/:jobId",
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const extensionRequests =
      await DeadlineExtensionService.getJobExtensionRequests(req.params.jobId);

    res.json(extensionRequests);
  }),
);

/**
 * GET /api/deadline-extensions/pending
 * Get pending extension requests for the current user
 */
router.get(
  "/pending",
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const extensionRequests =
      await DeadlineExtensionService.getUserPendingExtensionRequests(
        req.userId!,
      );

    res.json(extensionRequests);
  }),
);

export default router;
