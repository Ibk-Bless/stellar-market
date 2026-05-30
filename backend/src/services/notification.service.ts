import { PrismaClient, NotificationType } from "@prisma/client";
import { getIo } from "../socket";
import { EmailService } from "./email.service";
import { config } from "../config";
import { logger } from "../lib/logger";

const prisma = new PrismaClient();

interface BatchedNotification {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: any;
  timestamp: number;
}

interface NotificationBatch {
  userId: string;
  type: NotificationType;
  notifications: BatchedNotification[];
  timeoutId: NodeJS.Timeout;
}

export class NotificationService {
  private static batches = new Map<string, NotificationBatch>();
  private static readonly BATCH_WINDOW_MS = 5000; // 5 seconds
  private static readonly MAX_BATCH_SIZE = 10;

  /**
   * Creates a notification in the database and sends it in real-time via Socket.IO.
   */
  static async sendNotification(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    metadata?: any;
    skipBatching?: boolean; // Allow bypassing batching for urgent notifications
  }) {
    const {
      userId,
      type,
      title,
      message,
      metadata,
      skipBatching = false,
    } = params;

    try {
      // Skip batching for certain urgent notification types or when explicitly requested
      const urgentTypes: NotificationType[] = [
        "DISPUTE_RAISED",
        "DISPUTE_RESOLVED",
      ];

      if (skipBatching || urgentTypes.includes(type)) {
        return await this.sendImmediateNotification({
          userId,
          type,
          title,
          message,
          metadata,
        });
      }

      // Add to batch
      await this.addToBatch({
        userId,
        type,
        title,
        message,
        metadata,
        timestamp: Date.now(),
      });

      return null; // Batched notifications don't return immediately
    } catch (error) {
      logger.error({ err: error }, "Error sending notification");
      return null;
    }
  }

  /**
   * Sends a notification immediately without batching
   */
  private static async sendImmediateNotification(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    metadata?: any;
  }) {
    const { userId, type, title, message, metadata } = params;

    // 1. Create DB record (ensure commit before emitting)
    const notification = await prisma.$transaction(async (tx) => {
      return await tx.notification.create({
        data: {
          userId,
          type,
          title,
          message,
          metadata: metadata || {},
        },
      });
    });

    void this.maybeSendEmailForNotification({
      userId,
      type,
      title,
      message,
      metadata: metadata || {},
    });

    // 2. Emit real-time event via Socket.IO
    const io = getIo();
    io.to(`user:${userId}`).emit("notification:new", notification);

    logger.info({ userId, type, title }, "Notification sent");
    return notification;
  }

  /**
   * Adds a notification to the batching queue
   */
  private static async addToBatch(notification: BatchedNotification) {
    const batchKey = `${notification.userId}:${notification.type}`;
    const existingBatch = this.batches.get(batchKey);

    if (existingBatch) {
      // Add to existing batch
      existingBatch.notifications.push(notification);

      // If batch is full, flush immediately
      if (existingBatch.notifications.length >= this.MAX_BATCH_SIZE) {
        clearTimeout(existingBatch.timeoutId);
        await this.flushBatch(batchKey);
      }
    } else {
      // Create new batch
      const timeoutId = setTimeout(async () => {
        await this.flushBatch(batchKey);
      }, this.BATCH_WINDOW_MS);

      this.batches.set(batchKey, {
        userId: notification.userId,
        type: notification.type,
        notifications: [notification],
        timeoutId,
      });
    }
  }

  /**
   * Flushes a batch and sends the combined notification
   */
  private static async flushBatch(batchKey: string) {
    const batch = this.batches.get(batchKey);
    if (!batch || batch.notifications.length === 0) {
      return;
    }

    try {
      const { userId, type, notifications } = batch;

      // Remove batch from map
      this.batches.delete(batchKey);

      // If only one notification, send it normally
      if (notifications.length === 1) {
        const notif = notifications[0];
        return await this.sendImmediateNotification({
          userId: notif.userId,
          type: notif.type,
          title: notif.title,
          message: notif.message,
          metadata: notif.metadata,
        });
      }

      // Create batched notification
      const batchedNotification = this.createBatchedNotification(
        type,
        notifications,
      );

      return await this.sendImmediateNotification({
        userId,
        type,
        title: batchedNotification.title,
        message: batchedNotification.message,
        metadata: {
          ...batchedNotification.metadata,
          isBatched: true,
          batchCount: notifications.length,
          batchedNotifications: notifications.map((n) => ({
            title: n.title,
            message: n.message,
            metadata: n.metadata,
            timestamp: n.timestamp,
          })),
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error flushing notification batch");
    }
  }

  /**
   * Creates a combined notification from multiple similar notifications
   */
  private static createBatchedNotification(
    type: NotificationType,
    notifications: BatchedNotification[],
  ): { title: string; message: string; metadata: any } {
    const count = notifications.length;

    switch (type) {
      case "MILESTONE_APPROVED":
        return {
          title: `${count} Milestones Approved`,
          message: `${count} of your milestones have been approved by the client.`,
          metadata: { type: "batch_milestone_approved" },
        };

      case "MILESTONE_SUBMITTED":
        return {
          title: `${count} Milestones Submitted`,
          message: `The freelancer has submitted ${count} milestones for your review.`,
          metadata: { type: "batch_milestone_submitted" },
        };

      case "APPLICATION_REJECTED":
        return {
          title: `${count} Applications Rejected`,
          message: `${count} of your job applications have been rejected.`,
          metadata: { type: "batch_application_rejected" },
        };

      case "JOB_APPLIED":
        return {
          title: `${count} New Applications`,
          message: `You have received ${count} new applications for your jobs.`,
          metadata: { type: "batch_job_applied" },
        };

      case "NEW_MESSAGE":
        return {
          title: `${count} New Messages`,
          message: `You have ${count} new messages.`,
          metadata: { type: "batch_new_message" },
        };

      default:
        return {
          title: `${count} New Notifications`,
          message: `You have ${count} new ${type.toLowerCase().replace(/_/g, " ")} notifications.`,
          metadata: { type: "batch_generic" },
        };
    }
  }

  /**
   * Flushes all pending batches (useful for shutdown or testing)
   */
  static async flushAllBatches() {
    const batchKeys = Array.from(this.batches.keys());
    await Promise.all(batchKeys.map((key) => this.flushBatch(key)));
  }

  /**
   * Clears all batches and timeouts (useful for shutdown)
   */
  static clearAllBatches() {
    for (const batch of this.batches.values()) {
      clearTimeout(batch.timeoutId);
    }
    this.batches.clear();
  }

  private static async maybeSendEmailForNotification(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    metadata: any;
  }): Promise<void> {
    const { userId, type, title, message, metadata } = params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        emailVerified: true,
        notificationPreference: true,
      },
    });

    const email = user?.email;
    if (!email || !user?.emailVerified) return;

    const pref = user.notificationPreference;
    if ((pref?.emailEnabled ?? true) === false) return;

    const shouldSend = (() => {
      switch (type) {
        case "DISPUTE_RAISED":
          return pref?.emailDisputeOpened ?? true;
        case "DISPUTE_RESOLVED":
          return pref?.emailDisputeOpened ?? true;
        case "MILESTONE_APPROVED":
          return pref?.emailMilestoneApproved ?? true;
        case "PAYMENT_RELEASED":
          return pref?.emailPaymentReleased ?? true;
        case "APPLICATION_ACCEPTED":
          return pref?.emailApplicationAccepted ?? true;
        default:
          return false;
      }
    })();

    if (!shouldSend) return;

    const actionUrl =
      typeof metadata?.jobId === "string"
        ? `${config.frontendUrl}/jobs/${metadata.jobId}`
        : config.frontendUrl;

    const event = (() => {
      switch (type) {
        case "DISPUTE_RAISED":
          return "dispute.opened" as const;
        case "DISPUTE_RESOLVED":
          return "dispute.resolved" as const;
        case "MILESTONE_APPROVED":
          return "milestone.approved" as const;
        case "PAYMENT_RELEASED":
          return "payment.released" as const;
        case "APPLICATION_ACCEPTED":
          return "application.accepted" as const;
        default:
          return null;
      }
    })();

    if (!event) return;

    try {
      await EmailService.sendEventEmail({
        to: email,
        event,
        title,
        message,
        outcome: metadata?.outcome,
        actionUrl,
      });
    } catch (error) {
      logger.error(
        { err: error, userId, type },
        "Failed to send notification email",
      );
    }
  }

  /**
   * Marks a single notification as read.
   */
  static async markAsRead(notificationId: string, userId: string) {
    return prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId,
      },
      data: {
        read: true,
      },
    });
  }

  /**
   * Marks all notifications as read for a specific user.
   */
  static async markAllAsRead(userId: string) {
    const result = await prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
      },
    });

    if (result.count > 0) {
      const io = getIo();
      io.to(`user:${userId}`).emit("notifications:read");
    }

    return result;
  }

  /**
   * Gets unread notification count for a specific user.
   */
  static async getUnreadCount(userId: string) {
    return prisma.notification.count({
      where: {
        userId,
        read: false,
      },
    });
  }

  /**
   * Gets paginated notifications for a specific user.
   */
  static async getNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: { userId } }),
    ]);

    return {
      data: notifications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a notification by id
   */
  static async getById(id: string) {
    return prisma.notification.findUnique({ where: { id } });
  }

  /**
   * Delete a notification by id
   */
  static async deleteById(id: string) {
    return prisma.notification.delete({ where: { id } });
  }

  /**
   * Delete all read notifications for a user
   */
  static async deleteAllRead(userId: string) {
    return prisma.notification.deleteMany({ where: { userId, read: true } });
  }
}
