import { Server as HttpServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { registerMessageHandlers } from "./messageHandlers";
import { logger } from "../lib/logger";
import { startNotificationWorker } from "../lib/notification-queue";

const prisma = new PrismaClient();

export interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
  };
}

let io: SocketServer;

const userSocketMap = new Map<string, string>();

export function isUserOnline(userId: string): boolean {
  const socketId = userSocketMap.get(userId);
  if (!socketId) return false;
  return io?.sockets.sockets.has(socketId) ?? false;
}

export function emitToUser(userId: string, event: string, data: unknown): void {
  io?.to(`user:${userId}`).emit(event, data);
}

async function deliverPendingNotifications(socket: AuthenticatedSocket, userId: string) {
  try {
    const pending = await prisma.pendingNotification.findMany({
      where: { userId, deliveredAt: null },
      include: { notification: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    for (const p of pending) {
      socket.emit("notification:new", p.notification);
      await prisma.pendingNotification.update({
        where: { id: p.id },
        data: { deliveredAt: new Date() },
      });
    }

    if (pending.length > 0) {
      logger.info({ userId, count: pending.length }, "Delivered pending notifications on reconnect");
    }
  } catch (err) {
    logger.error({ err, userId }, "Error delivering pending notifications");
  }
}

export function initSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: config.frontendUrl,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // JWT auth middleware — runs before every connection
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      return next(new Error("Authentication error: No token provided."));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      (socket as AuthenticatedSocket).data.userId = decoded.userId;
      next();
    } catch {
      next(new Error("Authentication error: Invalid or expired token."));
    }
  });

  io.on("connection", (socket) => {
    const authedSocket = socket as AuthenticatedSocket;
    const userId = authedSocket.data.userId;
    const joinedRooms = new Set<string>();

    userSocketMap.set(userId, socket.id);
    socket.join(`user:${userId}`);
    joinedRooms.add(`user:${userId}`);
    logger.info({ userId, socketId: socket.id }, "Socket connected");

    void deliverPendingNotifications(authedSocket, userId);

    registerMessageHandlers(io, authedSocket);

    socket.on("disconnect", () => {
      userSocketMap.delete(userId);
      for (const room of joinedRooms) {
        socket.leave(room);
      }
      logger.info({ userId, socketId: socket.id }, "Socket disconnected");
    });
  });

  startNotificationWorker(isUserOnline, emitToUser);

  return io;
}

export function getIo(): SocketServer {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
}
