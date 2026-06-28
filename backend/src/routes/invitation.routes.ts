import { Router, Response } from "express";
import { PrismaClient, NotificationType } from "@prisma/client";
import { authenticate, AuthRequest } from "../middleware/auth";
import { validate } from "../middleware/validation";
import { asyncHandler } from "../middleware/error";
import { NotificationService } from "../services/notification.service";
import { createInvitationSchema, invitationJobParamSchema } from "../schemas";

const router = Router();
/**
 * @swagger
 * tags:
 *   name: Invitations
 *   description: Client-initiated job invitations for freelancers
 */
const prisma = new PrismaClient();

// Invite a freelancer to one of the client's jobs (client-only)
router.post(
  "/jobs/:jobId/invitations",
  authenticate,
  validate({ params: invitationJobParamSchema, body: createInvitationSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const jobId = req.params.jobId as string;
    const { freelancerId, message } = req.body as {
      freelancerId: string;
      message?: string;
    };

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, clientId: true, title: true, status: true },
    });
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    // Only the job's owner (a client) may invite freelancers to it.
    if (job.clientId !== req.userId) {
      return res
        .status(403)
        .json({ error: "Only the job owner can send invitations." });
    }
    if (job.status !== "OPEN") {
      return res
        .status(400)
        .json({ error: "Invitations can only be sent for open jobs." });
    }
    if (freelancerId === req.userId) {
      return res.status(400).json({ error: "You cannot invite yourself." });
    }

    const freelancer = await prisma.user.findUnique({
      where: { id: freelancerId },
      select: { id: true, role: true, username: true },
    });
    if (!freelancer) {
      return res.status(404).json({ error: "Freelancer not found." });
    }
    if (freelancer.role !== "FREELANCER") {
      return res
        .status(400)
        .json({ error: "Invitations can only be sent to freelancers." });
    }

    const existing = await prisma.invitation.findUnique({
      where: { jobId_freelancerId: { jobId, freelancerId } },
    });
    if (existing) {
      return res
        .status(409)
        .json({ error: "This freelancer has already been invited to this job." });
    }

    const inviter = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { username: true },
    });

    const invitation = await prisma.invitation.create({
      data: {
        jobId,
        freelancerId,
        clientId: req.userId!,
        message: message ?? null,
      },
    });

    // Surface the invitation in the freelancer's notification centre.
    await NotificationService.sendNotification({
      userId: freelancerId,
      type: NotificationType.JOB_INVITATION,
      title: "New Job Invitation",
      message: `${inviter?.username ?? "A client"} invited you to apply for: ${job.title}`,
      metadata: { jobId, invitationId: invitation.id },
    });

    res.status(201).json(invitation);
  }),
);

// List invitations sent for a job (client-only)
router.get(
  "/jobs/:jobId/invitations",
  authenticate,
  validate({ params: invitationJobParamSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const jobId = req.params.jobId as string;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { clientId: true },
    });
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    if (job.clientId !== req.userId) {
      return res
        .status(403)
        .json({ error: "Not authorized to view invitations for this job." });
    }

    const invitations = await prisma.invitation.findMany({
      where: { jobId },
      orderBy: { createdAt: "desc" },
      include: {
        freelancer: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    res.json({ data: invitations, total: invitations.length });
  }),
);

export default router;
