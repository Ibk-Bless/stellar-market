import { Server as SocketServer } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { AuthenticatedSocket } from "./index";
import { logger } from "../lib/logger";

const prisma = new PrismaClient();

export function registerMessageHandlers(
  io: SocketServer,
  socket: AuthenticatedSocket
): void {
  const senderId = socket.data.userId;

  // ─── send_message ────────────────────────────────────────────────────────────
  socket.on(
    "send_message",
    async (
      payload: { receiverId: string; content: string; jobId?: string; clientId?: string },
      ack?: (response: { ok: boolean; message?: unknown; error?: string }) => void
    ) => {
      const { receiverId, content, jobId, clientId } = payload;

      if (!receiverId || !content) {
        const error = "receiverId and content are required.";
        socket.emit("error", { message: error });
        ack?.({ ok: false, error });
        return;
      }

      try {
        // Idempotency: if this clientId was already persisted (e.g. the
        // original ack was lost but the write actually succeeded), return
        // the existing row instead of creating a duplicate message.
        if (clientId) {
          const existing = await prisma.message.findUnique({
            where: { clientId },
            include: {
              sender: { select: { id: true, username: true, avatarUrl: true } },
              receiver: { select: { id: true, username: true, avatarUrl: true } },
            },
          });

          if (existing) {
            ack?.({ ok: true, message: existing });
            return;
          }
        }

        const message = await prisma.message.create({
          data: {
            senderId,
            receiverId,
            jobId: jobId ?? null,
            content,
            clientId: clientId ?? null,
          },
          include: {
            sender: { select: { id: true, username: true, avatarUrl: true } },
            receiver: { select: { id: true, username: true, avatarUrl: true } },
          },
        });

        // Emit to receiver's personal room
        io.to(`user:${receiverId}`).emit("new_message", message);
        // Also emit back to sender (so other sender tabs update instantly)
        socket.emit("new_message", message);

        ack?.({ ok: true, message });
      } catch (err) {
        logger.error({ err, senderId, receiverId }, "send_message error");
        socket.emit("error", { message: "Failed to send message." });
        ack?.({ ok: false, error: "Failed to send message." });
      }
    }
  );

  // ─── mark_read ───────────────────────────────────────────────────────────────
  socket.on("mark_read", async (payload: { senderId: string }) => {
    const { senderId: originalSenderId } = payload;

    if (!originalSenderId) {
      socket.emit("error", { message: "senderId is required." });
      return;
    }

    try {
      await prisma.message.updateMany({
        where: {
          senderId: originalSenderId,
          receiverId: senderId,
          read: false,
        },
        data: { read: true },
      });

      // Notify the original sender that their messages were read
      io.to(`user:${originalSenderId}`).emit("messages_read", {
        byUserId: senderId,
      });
    } catch (err) {
      logger.error({ err, senderId, originalSenderId }, "mark_read error");
      socket.emit("error", { message: "Failed to mark messages as read." });
    }
  });

  // ─── typing_start ────────────────────────────────────────────────────────────
  socket.on("typing_start", (payload: { receiverId: string }) => {
    const { receiverId } = payload;
    if (!receiverId) return;

    io.to(`user:${receiverId}`).emit("user_typing", { userId: senderId });
  });

  // ─── typing_stop ─────────────────────────────────────────────────────────────
  socket.on("typing_stop", (payload: { receiverId: string }) => {
    const { receiverId } = payload;
    if (!receiverId) return;

    io.to(`user:${receiverId}`).emit("user_stopped_typing", { userId: senderId });
  });
}
