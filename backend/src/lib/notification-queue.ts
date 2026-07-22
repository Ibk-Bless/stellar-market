import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { PrismaClient, NotificationType } from "@prisma/client";
import RedisClient from "./redis";
import { logger } from "./logger";

const prisma = new PrismaClient();

export enum NotificationPriority {
  CRITICAL = 1,
  HIGH = 2,
  NORMAL = 3,
  LOW = 4,
}

export interface NotificationJobData {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  notificationId: string;
  priority: NotificationPriority;
}

const connection = RedisClient.getInstance();

export const notificationQueue = new Queue<NotificationJobData, any, string>("notifications", {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 500,
    removeOnFail: false,
  },
});

export function getNotificationPriority(type: NotificationType): NotificationPriority {
  switch (type) {
    case "PAYMENT_RELEASED":
    case "DISPUTE_RAISED":
    case "DISPUTE_RESOLVED":
      return NotificationPriority.CRITICAL;

    case "MILESTONE_APPROVED":
    case "MILESTONE_SUBMITTED":
    case "NEW_MESSAGE":
    case "APPLICATION_ACCEPTED":
    case "APPLICATION_REJECTED":
      return NotificationPriority.HIGH;

    case "JOB_APPLIED":
    case "ESCROW_TTL_WARNING":
      return NotificationPriority.NORMAL;

    case "BADGE_AWARDED":
    default:
      return NotificationPriority.LOW;
  }
}

let worker: Worker<NotificationJobData, any, string> | null = null;

export function startNotificationWorker(
  getSocketEmitter: (userId: string) => boolean | Promise<boolean>,
  emitToUser: (userId: string, event: string, data: unknown) => void,
) {
  worker = new Worker<NotificationJobData, any, string>(
    "notifications",
    async (job: Job<NotificationJobData, any, string>) => {
      const { userId, notificationId } = job.data;

      const rateLimitKey = `notif:ratelimit:${userId}`;
      const count = await (connection as any).incr(rateLimitKey);
      if (count === 1) await (connection as any).expire(rateLimitKey, 1);

      if (count > 10) {
        await notificationQueue.add("send", job.data, {
          delay: 1000,
          priority: job.data.priority,
        });
        return;
      }

      // We need to try/catch external delivery here. If it fails, BullMQ handles retry.
      // But we need to use `NotificationService` dynamically to avoid circular import.
      // We pass the function in `startNotificationWorker` instead, but wait, `notificationQueue` is exported.
      // Actually, we can just require it inline here.
      const { NotificationService } = require("../services/notification.service");

      try {
        await NotificationService.deliverExternalNotification({
          userId,
          type: job.data.type,
          title: job.data.title,
          message: job.data.message,
          metadata: job.data.metadata || {},
        });
        
        await prisma.notification.update({
          where: { id: notificationId },
          data: { status: "sent", deliveredAt: new Date() },
        });
      } catch (error) {
        // Update status to failed so it can be seen in the UI, but rethrow so BullMQ retries
        await prisma.notification.update({
          where: { id: notificationId },
          data: { status: "failed" },
        });
        throw error;
      }

      const isOnline = await getSocketEmitter(userId);
      if (isOnline) {
        const notification = await prisma.notification.findUnique({
          where: { id: notificationId },
        });
        if (notification) {
          emitToUser(userId, "notification:new", notification);
          logger.info({ userId, notificationId, type: job.data.type }, "Notification delivered via socket");
        }
      } else {
        await prisma.pendingNotification.create({
          data: {
            userId,
            notificationId,
            priority: job.data.priority,
          },
        });
        logger.info({ userId, notificationId }, "User offline — notification queued for reconnect");
      }
    },
    {
      connection: connection as any,
      concurrency: 20,
    },
  );

  worker.on("failed", (job, err) => {
    if (job) {
      logger.error(
        { jobId: job.id, userId: job.data.userId, err },
        "Notification job failed",
      );
    }
  });

  logger.info("Notification worker started");
  return worker;
}

export async function getDlqJobs() {
  return notificationQueue.getFailed(0, 99);
}

export async function stopNotificationWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
}
