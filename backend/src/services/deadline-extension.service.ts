/**
 * Deadline Extension Service
 * Handles two-step approval process for deadline extensions
 * Solves the Soroban contract issue where extend_deadline requires simultaneous auth from both parties
 */
import {
  PrismaClient,
  DeadlineExtensionStatus,
  JobStatus,
} from "@prisma/client";
import { createError } from "../middleware/error";
import { ContractService } from "./contract.service";
import { NotificationService } from "./notification.service";
import { config } from "../config";

const prisma = new PrismaClient();

export class DeadlineExtensionService {
  /**
   * Request a deadline extension
   * Can be initiated by either client or freelancer
   */
  static async requestExtension(
    milestoneId: string,
    jobId: string,
    requestedById: string,
    newDeadline: Date,
    reason: string,
  ) {
    // Validate milestone exists
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: { job: { include: { client: true, freelancer: true } } },
    });

    if (!milestone) {
      throw createError("Milestone not found", 404);
    }

    if (milestone.jobId !== jobId) {
      throw createError("Milestone does not belong to this job", 400);
    }

    // Validate job exists and user is a participant
    const job = milestone.job;
    if (!job) {
      throw createError("Job not found", 404);
    }

    const isClient = job.clientId === requestedById;
    const isFreelancer = job.freelancerId === requestedById;

    if (!isClient && !isFreelancer) {
      throw createError(
        "Only job participants can request deadline extensions",
        403,
      );
    }

    // Validate new deadline is in the future
    if (newDeadline <= new Date()) {
      throw createError("New deadline must be in the future", 400);
    }

    // Check for existing pending extension request
    const existingRequest = await prisma.deadlineExtensionRequest.findFirst({
      where: {
        milestoneId,
        status: DeadlineExtensionStatus.PENDING,
      },
    });

    if (existingRequest) {
      throw createError(
        "A pending extension request already exists for this milestone",
        400,
      );
    }

    // Create extension request
    const extensionRequest = await prisma.deadlineExtensionRequest.create({
      data: {
        milestoneId,
        jobId,
        requestedById,
        newDeadline,
        reason,
        status: DeadlineExtensionStatus.PENDING,
      },
      include: {
        milestone: true,
        job: { include: { client: true, freelancer: true } },
        requestedBy: { select: { id: true, username: true } },
      },
    });

    // Notify the other party
    const otherPartyId = isClient ? job.freelancerId : job.clientId;
    const requesterName = isClient ? "Client" : "Freelancer";

    if (otherPartyId) {
      await NotificationService.sendNotification({
        userId: otherPartyId,
        type: "MILESTONE_SUBMITTED",
        title: "Deadline Extension Request",
        message: `${requesterName} has requested a deadline extension for milestone "${milestone.title}". Please review and approve or reject.`,
        metadata: {
          extensionRequestId: extensionRequest.id,
          milestoneId,
          jobId,
          newDeadline: newDeadline.toISOString(),
        },
        skipBatching: true,
      });
    }

    return extensionRequest;
  }

  /**
   * Approve a deadline extension request
   * Records approval from one party (client or freelancer)
   */
  static async approveExtension(
    extensionRequestId: string,
    approverId: string,
  ) {
    // Validate extension request exists
    const extensionRequest = await prisma.deadlineExtensionRequest.findUnique({
      where: { id: extensionRequestId },
      include: {
        milestone: true,
        job: { include: { client: true, freelancer: true } },
        requestedBy: { select: { id: true, username: true } },
      },
    });

    if (!extensionRequest) {
      throw createError("Extension request not found", 404);
    }

    if (extensionRequest.status !== DeadlineExtensionStatus.PENDING) {
      throw createError(
        `Cannot approve extension request with status: ${extensionRequest.status}`,
        400,
      );
    }

    // Validate approver is a job participant
    const job = extensionRequest.job;
    const isClient = job.clientId === approverId;
    const isFreelancer = job.freelancerId === approverId;

    if (!isClient && !isFreelancer) {
      throw createError(
        "Only job participants can approve extension requests",
        403,
      );
    }

    // Prevent self-approval (requester cannot approve their own request)
    if (extensionRequest.requestedById === approverId) {
      throw createError("You cannot approve your own extension request", 400);
    }

    // Update approval status
    let newStatus = DeadlineExtensionStatus.PENDING;
    let updateData: any = { updatedAt: new Date() };

    if (isClient) {
      updateData.clientApprovedAt = new Date();
      // Check if freelancer already approved
      if (extensionRequest.freelancerApprovedAt) {
        newStatus = DeadlineExtensionStatus.APPROVED_BY_BOTH;
      } else {
        newStatus = DeadlineExtensionStatus.APPROVED_BY_CLIENT;
      }
    } else {
      updateData.freelancerApprovedAt = new Date();
      // Check if client already approved
      if (extensionRequest.clientApprovedAt) {
        newStatus = DeadlineExtensionStatus.APPROVED_BY_BOTH;
      } else {
        newStatus = DeadlineExtensionStatus.APPROVED_BY_FREELANCER;
      }
    }

    updateData.status = newStatus;

    const updated = await prisma.deadlineExtensionRequest.update({
      where: { id: extensionRequestId },
      data: updateData,
      include: {
        milestone: true,
        job: { include: { client: true, freelancer: true } },
        requestedBy: { select: { id: true, username: true } },
      },
    });

    // Notify the other party about the approval
    const otherPartyId = isClient ? job.freelancerId : job.clientId;
    const approverRole = isClient ? "Client" : "Freelancer";

    if (otherPartyId) {
      await NotificationService.sendNotification({
        userId: otherPartyId,
        type: "MILESTONE_APPROVED",
        title: "Deadline Extension Approved",
        message: `${approverRole} has approved the deadline extension for milestone "${extensionRequest.milestone.title}".`,
        metadata: {
          extensionRequestId,
          milestoneId: extensionRequest.milestoneId,
          jobId: extensionRequest.jobId,
          status: newStatus,
        },
      });
    }

    // If both parties have approved, execute the on-chain transaction
    if (newStatus === DeadlineExtensionStatus.APPROVED_BY_BOTH) {
      await this.executeExtensionOnChain(updated);
    }

    return updated;
  }

  /**
   * Reject a deadline extension request
   */
  static async rejectExtension(
    extensionRequestId: string,
    rejectedById: string,
    rejectionReason: string,
  ) {
    // Validate extension request exists
    const extensionRequest = await prisma.deadlineExtensionRequest.findUnique({
      where: { id: extensionRequestId },
      include: {
        milestone: true,
        job: { include: { client: true, freelancer: true } },
        requestedBy: { select: { id: true, username: true } },
      },
    });

    if (!extensionRequest) {
      throw createError("Extension request not found", 404);
    }

    if (extensionRequest.status !== DeadlineExtensionStatus.PENDING) {
      throw createError(
        `Cannot reject extension request with status: ${extensionRequest.status}`,
        400,
      );
    }

    // Validate rejector is a job participant
    const job = extensionRequest.job;
    const isClient = job.clientId === rejectedById;
    const isFreelancer = job.freelancerId === rejectedById;

    if (!isClient && !isFreelancer) {
      throw createError(
        "Only job participants can reject extension requests",
        403,
      );
    }

    // Update rejection status
    const updated = await prisma.deadlineExtensionRequest.update({
      where: { id: extensionRequestId },
      data: {
        status: DeadlineExtensionStatus.REJECTED,
        rejectedBy: rejectedById,
        rejectionReason,
        updatedAt: new Date(),
      },
      include: {
        milestone: true,
        job: { include: { client: true, freelancer: true } },
        requestedBy: { select: { id: true, username: true } },
      },
    });

    // Notify the requester about the rejection
    await NotificationService.sendNotification({
      userId: extensionRequest.requestedById,
      type: "MILESTONE_SUBMITTED",
      title: "Deadline Extension Rejected",
      message: `Your deadline extension request for milestone "${extensionRequest.milestone.title}" has been rejected. Reason: ${rejectionReason}`,
      metadata: {
        extensionRequestId,
        milestoneId: extensionRequest.milestoneId,
        jobId: extensionRequest.jobId,
      },
    });

    return updated;
  }

  /**
   * Execute the deadline extension on-chain
   * Called after both parties have approved
   */
  static async executeExtensionOnChain(extensionRequest: any) {
    try {
      const job = extensionRequest.job;
      const milestone = extensionRequest.milestone;

      // Build the transaction XDR
      const xdr = await ContractService.buildExtendDeadlineTx(
        job.client.walletAddress,
        job.contractJobId!,
        milestone.onChainIndex!,
        Math.floor(extensionRequest.newDeadline.getTime() / 1000),
      );

      // Store XDR for frontend to sign
      // In a real implementation, this would be returned to the frontend
      // For now, we'll mark it as ready for signing
      await prisma.deadlineExtensionRequest.update({
        where: { id: extensionRequest.id },
        data: {
          status: DeadlineExtensionStatus.APPROVED_BY_BOTH,
        },
      });

      return {
        xdr,
        extensionRequestId: extensionRequest.id,
        message:
          "Both parties have approved. Please sign the transaction to complete the extension.",
      };
    } catch (error) {
      console.error("Error executing extension on-chain:", error);
      throw createError("Failed to prepare on-chain transaction", 500);
    }
  }

  /**
   * Confirm the on-chain deadline extension transaction
   */
  static async confirmExtensionTransaction(
    extensionRequestId: string,
    txHash: string,
  ) {
    const extensionRequest = await prisma.deadlineExtensionRequest.findUnique({
      where: { id: extensionRequestId },
      include: {
        milestone: true,
        job: true,
      },
    });

    if (!extensionRequest) {
      throw createError("Extension request not found", 404);
    }

    // Update milestone deadline
    await prisma.milestone.update({
      where: { id: extensionRequest.milestoneId },
      data: {
        contractDeadline: extensionRequest.newDeadline,
        dueDate: extensionRequest.newDeadline,
      },
    });

    // Update extension request with transaction hash
    const updated = await prisma.deadlineExtensionRequest.update({
      where: { id: extensionRequestId },
      data: {
        onChainTxHash: txHash,
        updatedAt: new Date(),
      },
      include: {
        milestone: true,
        job: { include: { client: true, freelancer: true } },
      },
    });

    // Notify both parties
    const job = extensionRequest.job;
    const message = `Deadline for milestone "${extensionRequest.milestone.title}" has been extended to ${extensionRequest.newDeadline.toLocaleDateString()}.`;

    await NotificationService.sendNotification({
      userId: job.clientId,
      type: "MILESTONE_APPROVED",
      title: "Deadline Extended",
      message,
      metadata: {
        extensionRequestId,
        milestoneId: extensionRequest.milestoneId,
        jobId: extensionRequest.jobId,
        txHash,
      },
    });

    if (job.freelancerId) {
      await NotificationService.sendNotification({
        userId: job.freelancerId,
        type: "MILESTONE_APPROVED",
        title: "Deadline Extended",
        message,
        metadata: {
          extensionRequestId,
          milestoneId: extensionRequest.milestoneId,
          jobId: extensionRequest.jobId,
          txHash,
        },
      });
    }

    return updated;
  }

  /**
   * Get pending extension requests for a job
   */
  static async getJobExtensionRequests(jobId: string) {
    return prisma.deadlineExtensionRequest.findMany({
      where: { jobId },
      include: {
        milestone: true,
        requestedBy: { select: { id: true, username: true, avatarUrl: true } },
        rejectedByUser: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get pending extension requests for a user
   */
  static async getUserPendingExtensionRequests(userId: string) {
    return prisma.deadlineExtensionRequest.findMany({
      where: {
        job: {
          OR: [{ clientId: userId }, { freelancerId: userId }],
        },
        status: DeadlineExtensionStatus.PENDING,
      },
      include: {
        milestone: true,
        job: { select: { id: true, title: true } },
        requestedBy: { select: { id: true, username: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
