/**
 * Dispute Management Service
 * Handles dispute creation, voting, resolution, and webhook processing
 */
import {
  PrismaClient,
  DisputeStatus,
  JobStatus,
  EscrowStatus,
} from "@prisma/client";
import { createError } from "../middleware/error";
import { NotificationService } from "./notification.service";
import { ContractService } from "./contract.service";
import { logger } from "../lib/logger";

const prisma = new PrismaClient();

export class DisputeService {
  /**
   * Create a new dispute for a job
   */
  static async createDispute(
    jobId: string,
    initiatorId: string,
    reason: string,
  ) {
    // Validate job exists and has both client and freelancer
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { client: true, freelancer: true },
    });

    if (!job) {
      throw createError("Job not found", 404);
    }

    if (!job.freelancer) {
      throw createError(
        "Job must have an assigned freelancer to raise a dispute",
        400,
      );
    }

    // Verify initiator is a participant
    if (job.clientId !== initiatorId && job.freelancerId !== initiatorId) {
      throw createError("Not a participant of this job", 403);
    }

    // CRITICAL: Verify escrow is funded before allowing dispute
    if (job.escrowStatus !== EscrowStatus.FUNDED) {
      throw createError(
        "Escrow must be funded before a dispute can be raised. Current status: " +
          job.escrowStatus,
        400,
      );
    }

    // Verify the job is in a disputable state (ACTIVE/IN_PROGRESS)
    const isDisputableStatus = job.status === JobStatus.IN_PROGRESS;

    if (!isDisputableStatus) {
      throw createError("Job is not in a disputable state", 400);
    }

    // Check for existing dispute
    const existingDispute = await prisma.dispute.findUnique({
      where: { jobId },
    });

    if (existingDispute) {
      throw createError("A dispute already exists for this job", 400);
    }

    // Create dispute
    const dispute = await prisma.dispute.create({
      data: {
        jobId,
        clientId: job.clientId,
        freelancerId: job.freelancerId!,
        initiatorId,
        reason,
        status: DisputeStatus.OPEN,
      },
      include: {
        job: { select: { title: true, budget: true } },
        client: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
            avatarUrl: true,
          },
        },
        freelancer: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
            avatarUrl: true,
          },
        },
        initiator: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Update job status
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.DISPUTED,
        escrowStatus: "DISPUTED",
      },
    });

    // Send notifications to both parties
    await NotificationService.sendNotification({
      userId: dispute.clientId,
      type: "DISPUTE_RAISED",
      title: "Dispute Raised",
      message: `A dispute has been raised for job "${dispute.job.title}". You have been notified as the client.`,
      metadata: { disputeId: dispute.id, jobId, initiatorId },
      skipBatching: true,
    });

    await NotificationService.sendNotification({
      userId: dispute.freelancerId,
      type: "DISPUTE_RAISED",
      title: "Dispute Raised",
      message: `A dispute has been raised for job "${dispute.job.title}". You have been notified as the freelancer.`,
      metadata: { disputeId: dispute.id, jobId, initiatorId },
      skipBatching: true,
    });

    return dispute;
  }

  /**
   * Initialize dispute creation (returns XDR for signing)
   */
  static async initRaiseDispute(
    jobId: string,
    initiatorId: string,
    reason: string,
    minVotes: number = 3,
  ) {
    // Validate job exists and has both client and freelancer
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { client: true, freelancer: true },
    });

    if (!job) {
      throw createError("Job not found", 404);
    }

    if (!job.freelancer) {
      throw createError(
        "Job must have an assigned freelancer to raise a dispute",
        400,
      );
    }

    // Verify initiator is a participant
    if (job.clientId !== initiatorId && job.freelancerId !== initiatorId) {
      throw createError("Not a participant of this job", 403);
    }

    // CRITICAL: Verify escrow is funded before allowing dispute
    if (job.escrowStatus !== EscrowStatus.FUNDED) {
      throw createError(
        "Escrow must be funded before a dispute can be raised. Current status: " +
          job.escrowStatus,
        400,
      );
    }

    // Verify the job is in a disputable state
    if (job.status !== JobStatus.IN_PROGRESS) {
      throw createError("Job is not in a disputable state", 400);
    }

    // Check for existing dispute
    const existingDispute = await prisma.dispute.findUnique({
      where: { jobId },
    });

    if (existingDispute) {
      throw createError("A dispute already exists for this job", 400);
    }

    // Determine respondent
    const respondentId =
      initiatorId === job.clientId ? job.freelancerId! : job.clientId;

    // In a real implementation, this would call ContractService to generate XDR
    // For now, return mock data
    return {
      xdr: "mock_xdr_for_raise_dispute",
      respondentId,
      jobId,
      reason,
      minVotes,
    };
  }

  /**
   * Confirm dispute transaction after blockchain confirmation
   */
  static async confirmDisputeTransaction(
    hash: string,
    type: string,
    jobId: string,
    onChainDisputeId: string,
    respondentId: string,
    reason: string,
    initiatorId: string,
  ) {
    if (type !== "RAISE_DISPUTE") {
      throw createError("Invalid transaction type", 400);
    }

    // Create dispute in database
    const dispute = await this.createDispute(jobId, initiatorId, reason);

    // Update with on-chain ID
    const updated = await prisma.dispute.update({
      where: { id: dispute.id },
      data: { onChainDisputeId },
      include: {
        job: true,
        client: { select: { id: true, username: true } },
        freelancer: { select: { id: true, username: true } },
      },
    });

    // Send notifications
    const { NotificationService } = await import("./notification.service");
    await NotificationService.sendNotification({
      userId: respondentId,
      type: "DISPUTE_RAISED",
      title: "Dispute Raised",
      message: `A dispute has been raised for job "${updated.job.title}"`,
      metadata: { disputeId: updated.id, jobId },
    });

    return updated;
  }

  /**
   * Get dispute by ID with full details
   */
  static async getDisputeById(id: string, includeVotes: boolean = false) {
    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: {
        job: {
          include: {
            client: {
              select: {
                id: true,
                username: true,
                walletAddress: true,
                avatarUrl: true,
              },
            },
            freelancer: {
              select: {
                id: true,
                username: true,
                walletAddress: true,
                avatarUrl: true,
              },
            },
          },
        },
        client: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
            avatarUrl: true,
          },
        },
        freelancer: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
            avatarUrl: true,
          },
        },
        initiator: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
            avatarUrl: true,
          },
        },
        votes: includeVotes
          ? {
              include: {
                voter: {
                  select: {
                    id: true,
                    username: true,
                    walletAddress: true,
                    avatarUrl: true,
                  },
                },
              },
              orderBy: { createdAt: "desc" },
            }
          : false,
        attachments: true,
        _count: { select: { votes: true } },
      },
    });

    if (!dispute) {
      throw new Error("Dispute not found");
    }

    const votes = await prisma.disputeVote.findMany({
      where: { disputeId: id },
      select: { choice: true },
    });
    const totalVotes = votes.length;
    const clientVotes = votes.filter((v) => v.choice === "CLIENT").length;
    const freelancerVotes = votes.filter((v) => v.choice === "FREELANCER").length;
    const splitVotes = totalVotes - clientVotes - freelancerVotes;

    let arbitrators: Array<{ address: string; displayName: string; avatarUrl: string | null }> = [];
    if (dispute.onChainDisputeId) {
      try {
        const addresses = await ContractService.getOnChainAssignedArbitrators(dispute.onChainDisputeId);
        if (addresses && addresses.length > 0) {
          arbitrators = await Promise.all(
            addresses.map(async (address) => {
              const user = await prisma.user.findFirst({
                where: { walletAddress: address },
                select: { username: true, avatarUrl: true },
              });
              if (user) {
                return {
                  address,
                  displayName: user.username,
                  avatarUrl: user.avatarUrl,
                };
              } else {
                return {
                  address,
                  displayName: `${address.slice(0, 4)}...${address.slice(-4)}`,
                  avatarUrl: null,
                };
              }
            })
          );
        }
      } catch (err) {
        logger.warn({ err, onChainDisputeId: dispute.onChainDisputeId }, "Failed to get on-chain arbitrators");
      }
    }

    const { votes: _votes, _count, ...rest } = dispute;

    return {
      ...rest,
      voteSummary: {
        totalVotes,
        clientVotes,
        freelancerVotes,
        splitVotes,
      },
      arbitrators,
    };
  }

  static async getVotesByDisputeId(
    disputeId: string,
    cursor?: string,
    limit: number = 20,
  ) {
    const safeLimit = Math.min(limit, 100);

    const votes = await prisma.disputeVote.findMany({
      where: { disputeId },
      take: safeLimit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        voter: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const hasMore = votes.length > safeLimit;
    const items = hasMore ? votes.slice(0, safeLimit) : votes;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      votes: items,
      pagination: {
        nextCursor,
        hasMore,
        limit: safeLimit,
      },
    };
  }

  /**
   * Get user's dispute history (initiated or involved)
   */
  static async getUserDisputeHistory(
    userId: string,
    filter: "all" | "initiated" | "involved" = "all",
    sortBy: "recent" | "oldest" = "recent",
    pagination: { page: number; limit: number } = { page: 1, limit: 20 },
  ) {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    // Build where clause based on filter
    let where: any = {
      OR: [
        { clientId: userId },
        { freelancerId: userId },
        { initiatorId: userId },
      ],
    };

    if (filter === "initiated") {
      where = { initiatorId: userId };
    } else if (filter === "involved") {
      where = {
        AND: [
          { initiatorId: { not: userId } },
          {
            OR: [{ clientId: userId }, { freelancerId: userId }],
          },
        ],
      };
    }

    // Determine sort order
    const orderBy =
      sortBy === "recent"
        ? { createdAt: "desc" as const }
        : { createdAt: "asc" as const };

    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where,
        include: {
          job: { select: { id: true, title: true, budget: true } },
          client: {
            select: {
              id: true,
              username: true,
              walletAddress: true,
              avatarUrl: true,
            },
          },
          freelancer: {
            select: {
              id: true,
              username: true,
              walletAddress: true,
              avatarUrl: true,
            },
          },
          initiator: {
            select: {
              id: true,
              username: true,
              walletAddress: true,
              avatarUrl: true,
            },
          },
          _count: { select: { votes: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.dispute.count({ where }),
    ]);

    // Transform disputes to include jobTitle and otherPartyName
    const transformedDisputes = disputes.map((dispute) => {
      // Determine the other party (not the current user)
      let otherParty = dispute.client;
      if (dispute.clientId === userId) {
        otherParty = dispute.freelancer;
      }

      return {
        ...dispute,
        jobTitle: dispute.job.title,
        otherPartyName: otherParty.username,
        otherPartyAvatar: otherParty.avatarUrl,
      };
    });

    return transformedDisputes;
  }

  /**
   * Get disputes with filtering and pagination
   */
  static async getDisputes(
    filters: { status?: DisputeStatus; userFilter?: Record<string, unknown> },
    pagination: { page: number; limit: number },
  ) {
    const { status, userFilter } = filters;
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const where = { ...(status ? { status } : {}), ...userFilter };

    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where,
        include: {
          job: { select: { title: true, budget: true } },
          client: {
            select: {
              id: true,
              username: true,
              walletAddress: true,
              avatarUrl: true,
            },
          },
          freelancer: {
            select: {
              id: true,
              username: true,
              walletAddress: true,
              avatarUrl: true,
            },
          },
          initiator: {
            select: {
              id: true,
              username: true,
              walletAddress: true,
              avatarUrl: true,
            },
          },
          _count: { select: { votes: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.dispute.count({ where }),
    ]);

    return {
      disputes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Cast a vote on a dispute
   * Validates voter eligibility and prevents duplicate votes
   */
  static async castVote(
    disputeId: string,
    voterId: string,
    choice: "CLIENT" | "FREELANCER",
    reason: string,
  ) {
    // Verify dispute exists and is open for voting
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { job: true },
    });

    if (!dispute) {
      throw new Error("Dispute not found");
    }

    if (dispute.status === DisputeStatus.RESOLVED) {
      throw new Error("Cannot vote on a resolved dispute");
    }

    // Prevent participants from voting
    if (voterId === dispute.clientId || voterId === dispute.freelancerId) {
      throw new Error("Dispute participants cannot vote");
    }

    // Check for duplicate vote
    const existingVote = await prisma.disputeVote.findUnique({
      where: {
        disputeId_voterId: {
          disputeId,
          voterId,
        },
      },
    });

    if (existingVote) {
      throw new Error("You have already voted on this dispute");
    }

    // Create vote
    const vote = await prisma.disputeVote.create({
      data: {
        disputeId,
        voterId,
        choice,
        reason,
      },
      include: {
        voter: {
          select: {
            id: true,
            username: true,
            walletAddress: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Update dispute status to IN_PROGRESS if it was OPEN
    if (dispute.status === DisputeStatus.OPEN) {
      await prisma.dispute.update({
        where: { id: disputeId },
        data: { status: DisputeStatus.IN_PROGRESS },
      });
    }

    // Notify both parties about the new vote
    const disputeDetails = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { job: true },
    });

    if (disputeDetails) {
      const voteChoice = choice === "CLIENT" ? "the client" : "the freelancer";
      await NotificationService.sendNotification({
        userId: dispute.clientId,
        type: "DISPUTE_RAISED",
        title: "New Vote on Your Dispute",
        message: `A community member voted in favor of ${voteChoice} on the dispute for "${disputeDetails.job.title}".`,
        metadata: { disputeId, jobId: dispute.jobId, voterId },
      });

      await NotificationService.sendNotification({
        userId: dispute.freelancerId,
        type: "DISPUTE_RAISED",
        title: "New Vote on Your Dispute",
        message: `A community member voted in favor of ${voteChoice} on the dispute for "${disputeDetails.job.title}".`,
        metadata: { disputeId, jobId: dispute.jobId, voterId },
      });
    }

    return vote;
  }

  /**
   * Resolve a dispute (admin or automated process)
   */
  static async resolveDispute(disputeId: string, outcome: string) {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { votes: true, job: true },
    });

    if (!dispute) {
      throw new Error("Dispute not found");
    }

    if (dispute.status === DisputeStatus.RESOLVED) {
      throw new Error("Dispute is already resolved");
    }

    // Update dispute
    const updatedDispute = await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.RESOLVED,
        outcome,
        resolvedAt: new Date(),
      },
      include: {
        job: true,
        client: { select: { id: true, username: true, walletAddress: true } },
        freelancer: {
          select: { id: true, username: true, walletAddress: true },
        },
        votes: { include: { voter: { select: { username: true } } } },
      },
    });

    // Update job status
    await prisma.job.update({
      where: { id: dispute.jobId },
      data: {
        status: JobStatus.COMPLETED,
        escrowStatus: "COMPLETED",
      },
    });

    // Send resolution notifications to both parties
    const outcomeMessage =
      outcome === "CLIENT"
        ? "The dispute has been resolved in favor of the client."
        : "The dispute has been resolved in favor of the freelancer.";

    await NotificationService.sendNotification({
      userId: updatedDispute.clientId,
      type: "DISPUTE_RESOLVED",
      title: "Dispute Resolved",
      message: `${outcomeMessage} Job: "${updatedDispute.job.title}"`,
      metadata: { disputeId, jobId: dispute.jobId, outcome },
      skipBatching: true,
    });

    await NotificationService.sendNotification({
      userId: updatedDispute.freelancerId,
      type: "DISPUTE_RESOLVED",
      title: "Dispute Resolved",
      message: `${outcomeMessage} Job: "${updatedDispute.job.title}"`,
      metadata: { disputeId, jobId: dispute.jobId, outcome },
      skipBatching: true,
    });

    return updatedDispute;
  }

  /**
   * Process webhook from blockchain
   */
  static async processWebhook(payload: {
    type: string;
    disputeId: string;
    onChainDisputeId?: string;
    jobId?: string;
    voterId?: string;
    choice?: "CLIENT" | "FREELANCER";
    outcome?: string;
    metadata?: Record<string, any>;
  }) {
    const {
      type,
      disputeId,
      onChainDisputeId,
      jobId,
      voterId,
      choice,
      outcome,
    } = payload;

    switch (type) {
      case "DISPUTE_RAISED":
        if (!onChainDisputeId || !disputeId) {
          throw new Error("Missing required fields for DISPUTE_RAISED");
        }
        // Update dispute with on-chain ID
        await prisma.dispute.update({
          where: { id: disputeId },
          data: { onChainDisputeId },
        });
        break;

      case "VOTE_CAST":
        if (!disputeId || !voterId || !choice) {
          throw new Error("Missing required fields for VOTE_CAST");
        }
        // Vote should already be recorded via API, this is confirmation
        break;

      case "DISPUTE_RESOLVED":
        if (!disputeId || !outcome) {
          throw new Error("Missing required fields for DISPUTE_RESOLVED");
        }
        await this.resolveDispute(disputeId, outcome);
        break;

      default:
        throw new Error(`Unknown webhook type: ${type}`);
    }

    return { success: true, message: `Webhook ${type} processed successfully` };
  }

  /**
   * Get vote statistics for a dispute
   */
  static async getVoteStats(disputeId: string) {
    const votes = await prisma.disputeVote.findMany({
      where: { disputeId },
      select: { choice: true },
    });

    const votesForClient = votes.filter((v) => v.choice === "CLIENT").length;
    const votesForFreelancer = votes.filter(
      (v) => v.choice === "FREELANCER",
    ).length;

    return {
      total: votes.length,
      votesForClient,
      votesForFreelancer,
    };
  }
}
