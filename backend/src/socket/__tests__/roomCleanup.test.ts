// ─── Notification queue mock (avoids Redis connection at module load) ─────────
jest.mock("../../lib/notification-queue", () => ({
  startNotificationWorker: jest.fn(),
  stopNotificationWorker: jest.fn().mockResolvedValue(undefined),
  notificationQueue: { add: jest.fn() },
  getNotificationPriority: jest.fn().mockReturnValue(4),
}));

// ─── Redis mock (socket/index.ts now needs a client for the redis adapter and
// presence registry; the fake supports the pub/sub + KV surface both use) ────
jest.mock("../../lib/redis", () => {
  const { FakeRedisBus, mockRedisModule } = require("../../lib/__tests__/testUtils/fakeRedis");
  return mockRedisModule(new FakeRedisBus());
});

// ─── Prisma mock ─────────────────────────────────────────────────────────────
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    pendingNotification: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import ioc from "socket.io-client";
import express from "express";
import jwt from "jsonwebtoken";
import { initSocket } from "../index";
import { config } from "../../config";

function makeToken(userId: string) {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: "1h" });
}

let io: SocketServer;
let httpServer: ReturnType<typeof createServer>;
let port: number;

beforeAll((done) => {
  const app = express();
  httpServer = createServer(app);
  io = initSocket(httpServer);
  httpServer.listen(0, () => {
    const addr = httpServer.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
    done();
  });
});

afterAll((done) => {
  io.close();
  httpServer.close(done);
});

function connectClient(token: string): Promise<ReturnType<typeof ioc>> {
  return new Promise((resolve, reject) => {
    const socket = ioc(`http://localhost:${port}`, {
      auth: { token },
      forceNew: true,
      transports: ["websocket"],
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err: Error) => {
      socket.disconnect();
      reject(err);
    });
  });
}

describe("room cleanup on disconnect", () => {
  it("clears room membership after disconnect", async () => {
    const token = makeToken("test-user-1");
    const client = await connectClient(token);

    const socketRoomsBefore = io.sockets.adapter.rooms;
    const userRoomKey = "user:test-user-1";
    const userRoomBefore = socketRoomsBefore.get(userRoomKey);
    expect(userRoomBefore?.size ?? 0).toBeGreaterThan(0);

    client.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const userRoomAfter = socketRoomsBefore.get(userRoomKey);
    expect(userRoomAfter?.size ?? 0).toBe(0);
  });
});