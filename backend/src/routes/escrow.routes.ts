import { Router, Response } from "express";
import { PrismaClient, EscrowStatus, NotificationType } from "@prisma/client";
import { authenticate, AuthRequest } from "../middleware/auth";
import { walletSourceGuard } from "../middleware/wallet-guard";
import { asyncHandler } from "../middleware/error";
import { ContractService, ContractSimulationError } from "../services/contract.service";
import { NotificationService } from "../services/notification.service";
import { config } from "../config";
import {
  invalidateCache,
  invalidateCacheKey,
  generateJobCacheKey,
  generateJobOnChainStatusCacheKey,
} from "../lib/cache";

const router = Router();
const prisma = new PrismaClient();

const STROOPS_PER_XLM = 10_000_000;
/** Default tolerated downside deviation for funding parity: 2%. */
const DEFAULT_MAX_SLIPPAGE_BPS = 200;
const indexerCursorState: {
  cursor: string | null;
  updatedAt: string;
} = {
  cursor: null,
  updatedAt: new Date().toISOString(),
};

/**
 * Request XDR to create a job on-chain.
 */
router.post("/init-create", authenticate, walletSourceGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { jobId } = req.body;
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { client: true, freelancer: true, milestones: { orderBy: { order: "asc" } } }
  });

  if (!job || !job.freelancer) {
    return res.status(404).json({ error: "Job with assigned freelancer not found." });
  }

  if (job.clientId !== req.userId) {
    return res.status(403).json({ error: "Only the client can initialize the escrow." });
  }

  if (!job.deadline) {
    return res.status(400).json({ error: "Job must have a deadline before initializing escrow." });
  }

  if (!job.milestones || job.milestones.length === 0) {
    return res.status(400).json({ error: "Job must have at least one milestone before initializing escrow." });
  }

  const xdr = await ContractService.buildCreateJobTx(
    job.client.walletAddress!,
    job.freelancer.walletAddress!,
    config.stellar.nativeTokenId,
    job.milestones.map(m => ({
      description: m.title,
      amount: m.amount,
      deadline: Math.floor((m.contractDeadline?.getTime() || (Date.now() + 86400000 * 7)) / 1000)
    })),
    Math.floor(job.deadline.getTime() / 1000)
  );

  res.json({ xdr });
}));

/**
 * Request XDR to submit a milestone on-chain.
 */
router.post("/init-submit", authenticate, walletSourceGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { milestoneId } = req.body;
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    include: { job: { include: { freelancer: true } } },
  });

  if (!milestone || !milestone.job.contractJobId || milestone.onChainIndex === null) {
    return res.status(404).json({ error: "On-chain milestone not found." });
  }

  if (!milestone.job.freelancer || milestone.job.freelancerId !== req.userId) {
    return res.status(403).json({ error: "Only the assigned freelancer can submit milestones." });
  }

  const xdr = await ContractService.buildSubmitMilestoneTx(
    milestone.job.freelancer.walletAddress!,
    milestone.job.contractJobId!,
    milestone.onChainIndex,
  );

  res.json({ xdr });
}));

/**
 * Request XDR to fund a job on-chain.
 */
router.post("/init-fund", authenticate, walletSourceGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { jobId, maxSlippageBps, bypassOracle } = req.body as {
    jobId?: string;
    maxSlippageBps?: number;
    bypassOracle?: boolean;
  };
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { client: true }
  });

  if (!job || !job.contractJobId) {
    return res.status(404).json({ error: "On-chain job not found. Create it first." });
  }

  // Derive the agreed job value (in XLM stroops) from the job's budget so the
  // contract can validate the deposit against the DEX TWAP. A native-XLM job, or
  // an explicit opt-out, passes 0 to bypass the oracle check.
  const agreedValueStroops = bypassOracle
    ? 0n
    : BigInt(Math.round(job.budget * STROOPS_PER_XLM));
  const slippageBps =
    typeof maxSlippageBps === "number" && maxSlippageBps >= 0 && maxSlippageBps <= 10_000
      ? Math.floor(maxSlippageBps)
      : DEFAULT_MAX_SLIPPAGE_BPS;

  const effectiveSlippage = agreedValueStroops === 0n ? 0 : slippageBps;

  // Pre-flight the parity check so an under-value or oracle failure is returned
  // as a structured 422 instead of letting the user sign a doomed transaction.
  if (agreedValueStroops > 0n) {
    const sim = await ContractService.simulateFundJob(
      job.client.walletAddress!,
      job.contractJobId!,
      agreedValueStroops,
      effectiveSlippage,
    );
    if (!sim.ok && sim.reason === "INSUFFICIENT_VALUE") {
      return res.status(422).json({
        error: "InsufficientValue",
        message:
          "The deposit is worth less than the agreed job value at the current exchange rate.",
        agreedValueStroops: agreedValueStroops.toString(),
        maxSlippageBps: effectiveSlippage,
      });
    }
    if (!sim.ok && sim.reason === "ORACLE_UNAVAILABLE") {
      return res.status(503).json({
        error: "OracleUnavailable",
        message: "The exchange-rate oracle is currently unavailable. Try again shortly.",
      });
    }
  }

  const xdr = await ContractService.buildFundJobTx(
    job.client.walletAddress!,
    job.contractJobId!,
    agreedValueStroops,
    effectiveSlippage,
  );
  res.json({
    xdr,
    agreedValueStroops: agreedValueStroops.toString(),
    maxSlippageBps: effectiveSlippage,
  });
}));

/**
 * Read the stored exchange-rate parity (TWAP) snapshot for a job, for UI display.
 */
router.get("/:jobId/rate-snapshot", authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const jobId = req.params.jobId as string;
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { contractJobId: true },
  });

  if (!job || !job.contractJobId) {
    return res.status(404).json({ error: "On-chain job not found." });
  }

  try {
    const snapshot = await ContractService.getRateSnapshot(job.contractJobId);
    if (!snapshot) {
      return res.status(404).json({ error: "No rate snapshot recorded for this job." });
    }
    res.json({ jobId, snapshot });
  } catch (err) {
    if (err instanceof ContractSimulationError) {
      return res.status(404).json({ error: "No rate snapshot recorded for this job." });
    }
    throw err;
  }
}));

/**
 * Request XDR to approve a milestone on-chain.
 */
router.post("/init-approve", authenticate, walletSourceGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { milestoneId } = req.body;
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    include: { job: { include: { client: true } } }
  });

  if (!milestone || !milestone.job.contractJobId || milestone.onChainIndex === null) {
    return res.status(404).json({ error: "On-chain milestone not found." });
  }

  const xdr = await ContractService.buildApproveMilestoneTx(
    milestone.job.client.walletAddress!,
    milestone.job.contractJobId!,
    milestone.onChainIndex
  );

  res.json({ xdr });
}));

/**
 * Request XDR to cancel a funded job and refund the remaining escrow balance.
 */
router.post("/init-cancel", authenticate, walletSourceGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { jobId } = req.body;
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { client: true },
  });

  if (!job || !job.contractJobId) {
    return res.status(404).json({ error: "On-chain job not found." });
  }

  if (job.clientId !== req.userId) {
    return res.status(403).json({ error: "Only the client can cancel this job." });
  }

  const xdr = await ContractService.buildCancelJobTx(job.client.walletAddress!, job.contractJobId!);
  res.json({ xdr });
}));

/**
 * Request XDR to claim a refund after the auto-refund deadline has passed.
 */
router.post("/init-refund", authenticate, walletSourceGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { jobId } = req.body;
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { client: true },
  });

  if (!job || !job.contractJobId) {
    return res.status(404).json({ error: "On-chain job not found." });
  }

  if (job.clientId !== req.userId) {
    return res.status(403).json({ error: "Only the client can claim a refund." });
  }

  const xdr = await ContractService.buildClaimRefundTx(job.client.walletAddress!, job.contractJobId!);
  res.json({ xdr });
}));

/**
 * Request XDR to extend a milestone deadline on-chain.
 */
router.post("/init-extend-deadline", authenticate, walletSourceGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { milestoneId, newDeadline } = req.body;

  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    include: { job: { include: { client: true } } },
  });

  if (!milestone || !milestone.job.contractJobId || milestone.onChainIndex === null) {
    return res.status(404).json({ error: "On-chain milestone not found." });
  }

  if (milestone.job.clientId !== req.userId) {
    return res.status(403).json({ error: "Only the client can extend deadlines." });
  }

  const newDeadlineUnix = Math.floor(new Date(newDeadline).getTime() / 1000);

  const xdr = await ContractService.buildExtendDeadlineTx(
    milestone.job.client.walletAddress!,
    milestone.job.contractJobId!,
    milestone.onChainIndex,
    newDeadlineUnix,
  );

  res.json({ xdr });
}));

router.post(
  "/init-propose-revision",
  authenticate,
  walletSourceGuard,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { jobId, milestones } = req.body as {
      jobId?: string;
      milestones?: Array<{
        title?: string;
        description?: string;
        amount?: number;
        deadline?: string;
      }>;
    };

    if (!jobId || !Array.isArray(milestones) || milestones.length === 0) {
      return res.status(400).json({
        error: "jobId and a non-empty milestones array are required.",
      });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { client: true, freelancer: true },
    });

    if (!job?.contractJobId || !job.freelancer) {
      return res.status(404).json({
        error: "Job must have an assigned freelancer and on-chain escrow.",
      });
    }

    if (job.clientId !== req.userId && job.freelancerId !== req.userId) {
      return res.status(403).json({ error: "Only the client or freelancer may propose a revision." });
    }

    if (job.status !== "IN_PROGRESS" || job.escrowStatus !== "FUNDED") {
      return res.status(400).json({
        error: "Revisions are only available for in-progress jobs with funded escrow.",
      });
    }

    for (const m of milestones) {
      const amt = m.amount;
      if (typeof amt !== "number" || !Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: "Each milestone must have a positive amount." });
      }
      if (!m.deadline) {
        return res.status(400).json({ error: "Each milestone must have a deadline." });
      }
    }

    const callerWallet =
      job.clientId === req.userId
        ? job.client.walletAddress
        : job.freelancer!.walletAddress;

    const payload: { description: string; amount: number; deadlineUnix: number }[] = [];
    for (const m of milestones) {
      const text = (m.title || m.description || "").trim();
      if (!text) {
        return res.status(400).json({
          error: "Each milestone must have a title or description.",
        });
      }
      const deadlineUnix = Math.floor(new Date(m.deadline!).getTime() / 1000);
      if (!Number.isFinite(deadlineUnix) || deadlineUnix <= 0) {
        return res.status(400).json({ error: "Invalid milestone deadline." });
      }
      payload.push({
        description: text,
        amount: m.amount!,
        deadlineUnix,
      });
    }

    const xdr = await ContractService.buildProposeRevisionTx(
      callerWallet!,
      job.contractJobId!,
      payload
    );
    res.json({ xdr });
  })
);

router.post(
  "/init-accept-revision",
  authenticate,
  walletSourceGuard,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { jobId } = req.body as { jobId?: string };
    if (!jobId) {
      return res.status(400).json({ error: "jobId is required." });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { client: true, freelancer: true },
    });

    if (!job?.contractJobId || !job.freelancer) {
      return res.status(404).json({ error: "On-chain job not found." });
    }

    if (job.clientId !== req.userId && job.freelancerId !== req.userId) {
      return res.status(403).json({ error: "Only the client or freelancer may respond." });
    }

    const callerWallet =
      job.clientId === req.userId
        ? job.client.walletAddress
        : job.freelancer!.walletAddress;

    if (!callerWallet) {
      return res.status(400).json({ error: "Caller has no wallet address." });
    }

    const xdr = await ContractService.buildAcceptRevisionTx(
      callerWallet,
      job.contractJobId ?? ""
    );
    res.json({ xdr });
  })
);

router.post(
  "/init-reject-revision",
  authenticate,
  walletSourceGuard,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { jobId } = req.body as { jobId?: string };
    if (!jobId) {
      return res.status(400).json({ error: "jobId is required." });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { client: true, freelancer: true },
    });

    if (!job?.contractJobId || !job.freelancer) {
      return res.status(404).json({ error: "On-chain job not found." });
    }

    if (job.clientId !== req.userId && job.freelancerId !== req.userId) {
      return res.status(403).json({ error: "Only the client or freelancer may respond." });
    }

    const callerWallet =
      job.clientId === req.userId
        ? job.client.walletAddress
        : job.freelancer!.walletAddress;

    if (!callerWallet) {
      return res.status(400).json({ error: "Caller has no wallet address." });
    }

    const xdr = await ContractService.buildRejectRevisionTx(
      callerWallet,
      job.contractJobId ?? ""
    );
    res.json({ xdr });
  })
);

/**
 * Confirm transaction and update local database.
 * In a real app, this should ideally be handled by an event listener/indexer,
 * but for this integration task, we verify the hash provided by the frontend.
 */
router.post("/confirm-tx", authenticate, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { hash, type, jobId, milestoneId, onChainJobId } = req.body;

  const verification = await ContractService.verifyTransaction(hash);
  if (!verification.success) {
    return res.status(400).json({ error: `Transaction failed or not found: ${verification.error}` });
  }

  // Update DB based on transaction type
  if (type === "CREATE_JOB" && jobId && onChainJobId) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        contractJobId: onChainJobId.toString(),
        escrowStatus: EscrowStatus.UNFUNDED
      }
    });

    // Update milestones with their on-chain indices (0, 1, 2...)
    const milestones = await prisma.milestone.findMany({
      where: { jobId },
      orderBy: { order: "asc" }
    });
    for (let i = 0; i < milestones.length; i++) {
      await prisma.milestone.update({
        where: { id: milestones[i].id },
        data: { onChainIndex: i }
      });
    }
  } else if (type === "FUND_JOB" && jobId) {
    await prisma.job.update({
      where: { id: jobId },
      data: { escrowStatus: EscrowStatus.FUNDED }
    });
  } else if (type === "EXTEND_DEADLINE" && milestoneId) {
    const { newDeadline } = req.body;
    await prisma.milestone.update({
      where: { id: milestoneId },
      data: { contractDeadline: new Date(newDeadline) },
    });
  } else if (type === "SUBMIT_MILESTONE" && milestoneId) {
    let affectedJobId: string | null = null;
    await prisma.$transaction(async (tx) => {
      const updatedMilestone = await tx.milestone.update({
        where: { id: milestoneId },
        data: { status: "SUBMITTED" },
        include: { job: true },
      });

      if (!updatedMilestone.jobId) return;
      affectedJobId = updatedMilestone.jobId;

      await NotificationService.sendNotification({
        userId: updatedMilestone.job.clientId,
        type: NotificationType.MILESTONE_SUBMITTED,
        title: "Milestone Submitted",
        message: `Milestone "${updatedMilestone.title}" has been submitted for review.`,
        metadata: { jobId: updatedMilestone.jobId, milestoneId: updatedMilestone.id },
      });
    });
    if (affectedJobId) {
      await invalidateCache("jobs:list:*");
      await invalidateCacheKey(generateJobOnChainStatusCacheKey(affectedJobId));
      await invalidateCacheKey(generateJobCacheKey(affectedJobId));
    }
  } else if (type === "APPROVE_MILESTONE" && milestoneId) {
    let affectedJobId: string | null = null;
    await prisma.$transaction(async (tx) => {
      // Step 1: Update milestone status
      const updatedMilestone = await tx.milestone.update({
        where: { id: milestoneId },
        data: { status: "APPROVED" },
        include: { job: true }
      });

      if (!updatedMilestone.jobId) return;
      affectedJobId = updatedMilestone.jobId;

      // Step 2: Check if all milestones are approved to update job status
      const allMilestones = await tx.milestone.findMany({ 
        where: { jobId: updatedMilestone.jobId } 
      });

      if (allMilestones.every(m => m.status === "APPROVED")) {
        await tx.job.update({
          where: { id: updatedMilestone.jobId },
          data: {
            status: "COMPLETED",
            escrowStatus: EscrowStatus.COMPLETED
          }
        });
      }

      // Step 3: Notify the freelancer (inside transaction for consistency)
      if (updatedMilestone.job.freelancerId) {
        await NotificationService.sendNotification({
          userId: updatedMilestone.job.freelancerId,
          type: NotificationType.MILESTONE_APPROVED,
          title: "Milestone Approved",
          message: `Your milestone "${updatedMilestone.title}" has been approved and funds released!`,
          metadata: { jobId: updatedMilestone.jobId, milestoneId: updatedMilestone.id },
        });
      }
    });
    if (affectedJobId) {
      await invalidateCache("jobs:list:*");
      await invalidateCacheKey(generateJobOnChainStatusCacheKey(affectedJobId));
      await invalidateCacheKey(generateJobCacheKey(affectedJobId));
    }
  } else if (type === "PROPOSE_REVISION" && jobId) {
    await invalidateCacheKey(generateJobOnChainStatusCacheKey(jobId));
    await invalidateCacheKey(generateJobCacheKey(jobId));
  } else if (type === "ACCEPT_REVISION" && jobId) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { contractJobId: true },
    });
    if (job?.contractJobId) {
      await ContractService.syncJobFromChain(prisma, jobId, job.contractJobId);
    }
    await invalidateCacheKey(generateJobOnChainStatusCacheKey(jobId));
    await invalidateCacheKey(generateJobCacheKey(jobId));
  } else if (type === "REJECT_REVISION" && jobId) {
    await invalidateCacheKey(generateJobOnChainStatusCacheKey(jobId));
    await invalidateCacheKey(generateJobCacheKey(jobId));
  } else if ((type === "CANCEL_JOB" || type === "CLAIM_REFUND") && jobId) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "CANCELLED",
        escrowStatus: EscrowStatus.CANCELLED,
      },
    });
    await invalidateCacheKey(generateJobOnChainStatusCacheKey(jobId));
    await invalidateCacheKey(generateJobCacheKey(jobId));
  }

  res.json({ message: "Transaction confirmed and database updated." });
}));

/**
 * Expose/track indexer cursor state for escrow event sync workers.
 */
router.get(
  "/indexer/cursor",
  authenticate,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json(indexerCursorState);
  }),
);

router.put(
  "/indexer/cursor",
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const cursor = typeof req.body?.cursor === "string" ? req.body.cursor.trim() : "";
    if (!cursor) {
      return res.status(400).json({ error: "cursor is required." });
    }
    indexerCursorState.cursor = cursor;
    indexerCursorState.updatedAt = new Date().toISOString();
    return res.json(indexerCursorState);
  }),
);

router.get(
  "/:jobId/ttl",
  authenticate,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const jobId = req.params.jobId as string;
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { contractJobId: true },
    });

    if (!job || !job.contractJobId) {
      return res.status(404).json({ error: "Job or escrow not found." });
    }

    const ttlInfo = await ContractService.getEscrowTtl(job.contractJobId);
    if (!ttlInfo) {
      return res.status(404).json({ error: "Escrow not found on-chain." });
    }

    res.json(ttlInfo);
  })
);

export default router;
