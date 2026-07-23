import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import ioc, { type Socket as ClientSocket } from "socket.io-client";
import express from "express";
import jwt from "jsonwebtoken";
import { initSocket } from "../index";
import { config } from "../../config";

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
    message: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    pendingNotification: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

import { PrismaClient } from "@prisma/client";
const prismaMock = new PrismaClient() as jest.Mocked<PrismaClient>;
const messageMock = prismaMock.message as unknown as {
  create: jest.Mock;
  updateMany: jest.Mock;
  findUnique: jest.Mock;
};

// ─── Helper: make a signed JWT ────────────────────────────────────────────────
function makeToken(userId: string) {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: "1h" });
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────
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

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Helper: connect client ───────────────────────────────────────────────────
function connectClient(
  token?: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userId?: string
): Promise<ReturnType<typeof ioc>> {
  return new Promise((resolve, reject) => {
    const socket = ioc(`http://localhost:${port}`, {
      auth: token ? { token } : {},
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Socket.io auth middleware", () => {
  it("rejects connection with no token", async () => {
    await expect(connectClient(undefined)).rejects.toThrow();
  });

  it("rejects connection with an invalid token", async () => {
    await expect(connectClient("bad.token.here")).rejects.toThrow();
  });

  it("accepts connection with a valid JWT", async () => {
    const token = makeToken("user-1");
    const client = await connectClient(token);
    expect(client.connected).toBe(true);
    client.disconnect();
  });
});

describe("send_message event", () => {
  it("persists message and emits new_message to sender", async () => {
    const mockMessage = {
      id: "msg-1",
      senderId: "user-1",
      receiverId: "user-2",
      content: "Hello!",
      read: false,
      createdAt: new Date(),
      sender: { id: "user-1", username: "alice", avatarUrl: null },
      receiver: { id: "user-2", username: "bob", avatarUrl: null },
    };
    messageMock.create.mockResolvedValueOnce(mockMessage);

    const token = makeToken("user-1");
    const client = await connectClient(token);

    const received = await new Promise<unknown>((resolve) => {
      client.on("new_message", resolve);
      client.emit("send_message", { receiverId: "user-2", content: "Hello!" });
    });

    expect(messageMock.create).toHaveBeenCalledTimes(1);
    expect(messageMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "Hello!", receiverId: "user-2" }),
      })
    );
    expect(received).toMatchObject({ content: "Hello!" });
    client.disconnect();
  });

  it("also delivers new_message to the receiver's socket", async () => {
    const mockMessage = {
      id: "msg-2",
      senderId: "user-a",
      receiverId: "user-b",
      content: "Hey receiver!",
      read: false,
      createdAt: new Date(),
      sender: { id: "user-a", username: "alice", avatarUrl: null },
      receiver: { id: "user-b", username: "bob", avatarUrl: null },
    };
    messageMock.create.mockResolvedValueOnce(mockMessage);

    const senderClient = await connectClient(makeToken("user-a"));
    const receiverClient = await connectClient(makeToken("user-b"));

    const receiverGotMessage = new Promise<unknown>((resolve) => {
      receiverClient.on("new_message", resolve);
    });

    senderClient.emit("send_message", { receiverId: "user-b", content: "Hey receiver!" });

    const msg = await receiverGotMessage;
    expect(msg).toMatchObject({ content: "Hey receiver!" });

    senderClient.disconnect();
    receiverClient.disconnect();
  });

  it("emits error event when receiverId or content is missing", async () => {
    const client = await connectClient(makeToken("user-1"));

    const err = await new Promise<{ message: string }>((resolve) => {
      client.on("error", resolve);
      client.emit("send_message", { content: "oops — no receiver" });
    });

    expect(err.message).toMatch(/receiverId and content are required/i);
    client.disconnect();
  });

  it("acks with ok:true and the persisted message on a successful send", async () => {
    const mockMessage = {
      id: "msg-ack-1",
      clientId: "client-ack-1",
      senderId: "user-1",
      receiverId: "user-2",
      content: "Acked!",
      read: false,
      createdAt: new Date(),
      sender: { id: "user-1", username: "alice", avatarUrl: null },
      receiver: { id: "user-2", username: "bob", avatarUrl: null },
    };
    messageMock.findUnique.mockResolvedValueOnce(null);
    messageMock.create.mockResolvedValueOnce(mockMessage);

    const client = await connectClient(makeToken("user-1"));

    const ack = await new Promise<{ ok: boolean; message?: unknown }>((resolve) => {
      client.emit(
        "send_message",
        { receiverId: "user-2", content: "Acked!", clientId: "client-ack-1" },
        resolve
      );
    });

    expect(ack.ok).toBe(true);
    expect(ack.message).toMatchObject({ content: "Acked!", clientId: "client-ack-1" });
    expect(messageMock.create).toHaveBeenCalledTimes(1);
    client.disconnect();
  });

  it("is idempotent on clientId: a retried send with the same clientId does not create a duplicate", async () => {
    const existingMessage = {
      id: "msg-existing",
      clientId: "client-retry-1",
      senderId: "user-1",
      receiverId: "user-2",
      content: "Already sent",
      read: false,
      createdAt: new Date(),
      sender: { id: "user-1", username: "alice", avatarUrl: null },
      receiver: { id: "user-2", username: "bob", avatarUrl: null },
    };
    // Simulates the original write having already succeeded server-side
    // (e.g. the ack for it was lost), so findUnique short-circuits create.
    messageMock.findUnique.mockResolvedValueOnce(existingMessage);

    const client = await connectClient(makeToken("user-1"));

    const ack = await new Promise<{ ok: boolean; message?: unknown }>((resolve) => {
      client.emit(
        "send_message",
        { receiverId: "user-2", content: "Already sent", clientId: "client-retry-1" },
        resolve
      );
    });

    expect(ack.ok).toBe(true);
    expect(ack.message).toMatchObject({ id: "msg-existing", clientId: "client-retry-1" });
    expect(messageMock.create).not.toHaveBeenCalled();
    client.disconnect();
  });

  it("acks with ok:false when persisting the message fails", async () => {
    messageMock.findUnique.mockResolvedValueOnce(null);
    messageMock.create.mockRejectedValueOnce(new Error("db down"));

    const client = await connectClient(makeToken("user-1"));

    const ack = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      client.emit(
        "send_message",
        { receiverId: "user-2", content: "Will fail", clientId: "client-fail-1" },
        resolve
      );
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/failed to send message/i);
    client.disconnect();
  });
});

describe("mark_read event", () => {
  it("calls updateMany and emits messages_read to original sender", async () => {
    messageMock.updateMany.mockResolvedValueOnce({ count: 3 });

    const senderClient = await connectClient(makeToken("user-s"));
    const readerClient = await connectClient(makeToken("user-r"));

    const senderGotReadReceipt = new Promise<{ byUserId: string }>((resolve) => {
      senderClient.on("messages_read", resolve);
    });

    readerClient.emit("mark_read", { senderId: "user-s" });

    const receipt = await senderGotReadReceipt;
    expect(receipt.byUserId).toBe("user-r");
    expect(messageMock.updateMany).toHaveBeenCalledTimes(1);

    senderClient.disconnect();
    readerClient.disconnect();
  });
});

describe("typing events", () => {
  it("forwards user_typing to the receiver when typing_start is emitted", async () => {
    const typer = await connectClient(makeToken("typer-id"));
    const watcher = await connectClient(makeToken("watcher-id"));

    const typingEvent = new Promise<{ userId: string }>((resolve) => {
      watcher.on("user_typing", resolve);
    });

    typer.emit("typing_start", { receiverId: "watcher-id" });

    const evt = await typingEvent;
    expect(evt.userId).toBe("typer-id");

    typer.disconnect();
    watcher.disconnect();
  });

  it("forwards user_stopped_typing when typing_stop is emitted", async () => {
    const typer = await connectClient(makeToken("typer-id2"));
    const watcher = await connectClient(makeToken("watcher-id2"));

    const stoppedEvent = new Promise<{ userId: string }>((resolve) => {
      watcher.on("user_stopped_typing", resolve);
    });

    typer.emit("typing_stop", { receiverId: "watcher-id2" });

    const evt = await stoppedEvent;
    expect(evt.userId).toBe("typer-id2");

    typer.disconnect();
    watcher.disconnect();
  });
});
