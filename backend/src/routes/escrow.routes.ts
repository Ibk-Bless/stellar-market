import { Router, Response } from "express";
import { PrismaClient, EscrowStatus, NotificationType } from "@prisma/client";
import { authenticate, AuthRequest } from "../middleware/auth";
import { walletSourceGuard } from "../middleware/wallet-guard";
import { asyncHandler } from "../middleware/error";
import { idempotency } from "../middleware/idempotency";
import { ContractService, ContractSimulationError } from "../services/contract.service";
import { NotificationService } from "../services/notification.service";
import { config } from "../config";
import { withUpstreamTimeout } from "../lib/upstream-timeout";
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
    let sim;
    try {
      sim = await withUpstreamTimeout(
        () =>
          ContractService.simulateFundJob(
            job.client.walletAddress!,
            job.contractJobId!,
            agreedValueStroops,
            effectiveSlippage,
          ),
        { route: "escrow.init-fund", target: "soroban-rpc.simulateTransaction", code: "OracleUnavailable" },
      );
    } catch (err) {
      if (err instanceof Error && err.name === "UpstreamTimeoutError") {
        return res.status(502).json({
          error: "OracleUnavailable",
          message: "The exchange-rate oracle is currently unavailable. Try again shortly.",
        });
      }
      throw err;
    }

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

// Maps each confirm-tx type to the escrow contract function that must have been called.
const EXPECTED_CONTRACT_FN: Record<string, string> = {
  CREATE_JOB: "create_job",
  FUND_JOB: "fund_job",
  EXTEND_DEADLINE: "extend_deadline",
  SUBMIT_MILESTONE: "submit_milestone",
  APPROVE_MILESTONE: "approve_milestone",
  PROPOSE_REVISION: "propose_revision",
  ACCEPT_REVISION: "accept_revision",
  REJECT_REVISION: "reject_revision",
  CANCEL_JOB: "cancel_job",
  CLAIM_REFUND: "claim_refund",
};

/**
 * Confirm transaction and update local database.
 * Decodes the actual on-chain contract invocation from the transaction envelope
 * before applying any state change, and enforces per-job authorization for every
 * operation type.
 */
router.post("/confirm-tx", authenticate, idempotency(), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { hash, type, jobId, milestoneId, onChainJobId, newDeadline } = req.body;

  // ── 1. Decode on-chain effects ────────────────────────────────────────────
  const effects = await ContractService.verifyTransactionEffects(hash);
  if (!effects.success) {
    return res.status(400).json({ error: `Transaction verification failed: ${effects.error}` });
  }

  // ── 2. Contract address must be the configured escrow contract ────────────
  // Fail closed: missing contractId (decode failure) is treated the same as
  // a wrong contract — both are rejected rather than silently skipped.
  if (!effects.contractId || effects.contractId !== config.stellar.escrowContractId) {
    return res.status(403).json({ error: "Transaction invoked an unexpected contract" });
  }

  // ── 3. Function name must match the declared type ─────────────────────────
  const expectedFn = EXPECTED_CONTRACT_FN[type];
  if (expectedFn && effects.functionName && effects.functionName !== expectedFn) {
    return res.status(403).json({
      error: `Transaction called "${effects.functionName}" but type "${type}" requires "${expectedFn}"`,
    });
  }

  // ── 4. Source account must match the authenticated user's wallet ──────────
  // Fail closed: reject if the source account could not be decoded, if the
  // user has no registered wallet, or if the two don't match.
  const caller = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { walletAddress: true },
  });
  if (!effects.sourceAccount || !caller?.walletAddress || effects.sourceAccount !== caller.walletAddress) {
    return res.status(403).json({
      error: "Transaction source account does not match your registered wallet",
    });
  }

  // ── 5. Load job (and milestone) for authorization + arg checks ────────────
  // For milestone-only types the job is fetched through the milestone relation.
  type JobRow = {
    id: string;
    clientId: string;
    freelancerId: string | null;
    contractJobId: string | null;
    client: { walletAddress: string | null };
    freelancer: { walletAddress: string | null } | null;
  };

  let job: JobRow | null = null;
  let milestone: { id: string; onChainIndex: number | null; jobId: string | null } | null = null;

  if (milestoneId) {
    const ms = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: { job: { include: { client: true, freelancer: true } } },
    });
    if (!ms) return res.status(404).json({ error: "Milestone not found" });
    milestone = { id: ms.id, onChainIndex: ms.onChainIndex, jobId: ms.jobId };
    job = ms.job as unknown as JobRow;
  } else if (jobId) {
    job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { client: true, freelancer: true },
    }) as JobRow | null;
  }

  if (!job) return res.status(404).json({ error: "Job not found" });

  const args = effects.args ?? [];

  // ── 6. Per-type: authorization + arg validation + DB write ────────────────

  if (type === "CREATE_JOB" && jobId && onChainJobId) {
    if (job.clientId !== req.userId) {
      return res.status(403).json({ error: "Only the client can confirm job creation" });
    }
    // Args: (client: Address, freelancer: Address, token: Address, milestones: vec, deadline: u64)
    const argClient = args[0] !== undefined ? String(args[0]) : undefined;
    const argFreelancer = args[1] !== undefined ? String(args[1]) : undefined;
    if (argClient && job.client?.walletAddress && argClient !== job.client.walletAddress) {
      return res.status(403).json({ error: "Transaction client address does not match this job" });
    }
    if (argFreelancer && job.freelancer?.walletAddress && argFreelancer !== job.freelancer.walletAddress) {
      return res.status(403).json({ error: "Transaction freelancer address does not match this job" });
    }

    await prisma.job.update({
      where: { id: jobId },
      data: { contractJobId: onChainJobId.toString(), escrowStatus: EscrowStatus.UNFUNDED },
    });
    const milestones = await prisma.milestone.findMany({ where: { jobId }, orderBy: { order: "asc" } });
    for (let i = 0; i < milestones.length; i++) {
      await prisma.milestone.update({ where: { id: milestones[i].id }, data: { onChainIndex: i } });
    }

  } else if (type === "FUND_JOB" && jobId) {
    if (job.clientId !== req.userId) {
      return res.status(403).json({ error: "Only the client can confirm job funding" });
    }
    // Args: (job_id: u64, client: Address, agreed_value_stroops: i128, max_slippage_bps: u32)
    const argJobId = args[0] !== undefined ? String(args[0]) : undefined;
    if (argJobId && job.contractJobId && argJobId !== job.contractJobId) {
      return res.status(403).json({ error: "Transaction job ID does not match this job" });
    }

    await prisma.job.update({ where: { id: jobId }, data: { escrowStatus: EscrowStatus.FUNDED } });

  } else if (type === "EXTEND_DEADLINE" && milestoneId) {
    if (job.clientId !== req.userId) {
      return res.status(403).json({ error: "Only the client can confirm a deadline extension" });
    }
    // Args: (job_id: u64, milestone_index: u32, new_deadline: u64)
    const argJobId = args[0] !== undefined ? String(args[0]) : undefined;
    const argMilestoneIdx = args[1] !== undefined ? Number(args[1]) : undefined;
    if (argJobId && job.contractJobId && argJobId !== job.contractJobId) {
      return res.status(403).json({ error: "Transaction job ID does not match this job" });
    }
    if (argMilestoneIdx !== undefined && milestone?.onChainIndex !== null && milestone?.onChainIndex !== undefined && argMilestoneIdx !== milestone.onChainIndex) {
      return res.status(403).json({ error: "Transaction milestone index does not match this milestone" });
    }

    await prisma.milestone.update({
      where: { id: milestoneId },
      data: { contractDeadline: new Date(newDeadline) },
    });

  } else if (type === "SUBMIT_MILESTONE" && milestoneId) {
    if (job.freelancerId !== req.userId) {
      return res.status(403).json({ error: "Only the freelancer can confirm milestone submission" });
    }
    // Args: (job_id: u64, milestone_index: u32, freelancer: Address)
    const argJobId = args[0] !== undefined ? String(args[0]) : undefined;
    const argMilestoneIdx = args[1] !== undefined ? Number(args[1]) : undefined;
    if (argJobId && job.contractJobId && argJobId !== job.contractJobId) {
      return res.status(403).json({ error: "Transaction job ID does not match this job" });
    }
    if (argMilestoneIdx !== undefined && milestone?.onChainIndex !== null && milestone?.onChainIndex !== undefined && argMilestoneIdx !== milestone.onChainIndex) {
      return res.status(403).json({ error: "Transaction milestone index does not match this milestone" });
    }

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
    if (job.clientId !== req.userId) {
      return res.status(403).json({ error: "Only the client can confirm milestone approval" });
    }
    // Args: (job_id: u64, milestone_index: u32, ...)
    const argJobId = args[0] !== undefined ? String(args[0]) : undefined;
    const argMilestoneIdx = args[1] !== undefined ? Number(args[1]) : undefined;
    if (argJobId && job.contractJobId && argJobId !== job.contractJobId) {
      return res.status(403).json({ error: "Transaction job ID does not match this job" });
    }
    if (argMilestoneIdx !== undefined && milestone?.onChainIndex !== null && milestone?.onChainIndex !== undefined && argMilestoneIdx !== milestone.onChainIndex) {
      return res.status(403).json({ error: "Transaction milestone index does not match this milestone" });
    }

    let affectedJobId: string | null = null;
    await prisma.$transaction(async (tx) => {
      const updatedMilestone = await tx.milestone.update({
        where: { id: milestoneId },
        data: { status: "APPROVED" },
        include: { job: true },
      });
      if (!updatedMilestone.jobId) return;
      affectedJobId = updatedMilestone.jobId;
      const allMilestones = await tx.milestone.findMany({ where: { jobId: updatedMilestone.jobId } });
      if (allMilestones.every(m => m.status === "APPROVED")) {
        await tx.job.update({
          where: { id: updatedMilestone.jobId },
          data: { status: "COMPLETED", escrowStatus: EscrowStatus.COMPLETED },
        });
      }
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
    if (job.clientId !== req.userId && job.freelancerId !== req.userId) {
      return res.status(403).json({ error: "Only the client or freelancer can confirm a revision proposal" });
    }
    await invalidateCacheKey(generateJobOnChainStatusCacheKey(jobId));
    await invalidateCacheKey(generateJobCacheKey(jobId));

  } else if (type === "ACCEPT_REVISION" && jobId) {
    if (job.clientId !== req.userId && job.freelancerId !== req.userId) {
      return res.status(403).json({ error: "Only the client or freelancer can confirm revision acceptance" });
    }
    if (job.contractJobId) {
      await ContractService.syncJobFromChain(prisma, jobId, job.contractJobId);
    }
    await invalidateCacheKey(generateJobOnChainStatusCacheKey(jobId));
    await invalidateCacheKey(generateJobCacheKey(jobId));

  } else if (type === "REJECT_REVISION" && jobId) {
    if (job.clientId !== req.userId && job.freelancerId !== req.userId) {
      return res.status(403).json({ error: "Only the client or freelancer can confirm revision rejection" });
    }
    await invalidateCacheKey(generateJobOnChainStatusCacheKey(jobId));
    await invalidateCacheKey(generateJobCacheKey(jobId));

  } else if ((type === "CANCEL_JOB" || type === "CLAIM_REFUND") && jobId) {
    if (job.clientId !== req.userId) {
      return res.status(403).json({ error: "Only the client can confirm job cancellation or refund" });
    }
    // Args: (job_id: u64, client: Address)
    const argJobId = args[0] !== undefined ? String(args[0]) : undefined;
    if (argJobId && job.contractJobId && argJobId !== job.contractJobId) {
      return res.status(403).json({ error: "Transaction job ID does not match this job" });
    }

    await prisma.job.update({
      where: { id: jobId },
      data: { status: "CANCELLED", escrowStatus: EscrowStatus.CANCELLED },
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

    // asyncHandler forwards UpstreamTimeoutError to the global error handler,
    // which responds 502 { error: "HorizonUnavailable" } on expiry.
    const ttlInfo = await withUpstreamTimeout(
      () => ContractService.getEscrowTtl(job.contractJobId as string),
      { route: "escrow.ttl", target: "soroban-rpc.getLedgerEntries" },
    );

    if (!ttlInfo) {
      return res.status(404).json({ error: "Escrow not found on-chain." });
    }

    res.json(ttlInfo);
  })
);

export default router;
