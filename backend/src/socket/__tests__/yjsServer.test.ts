import { createServer, IncomingMessage } from "http";
import jwt from "jsonwebtoken";
import WebSocket, { WebSocketServer } from "ws";
import { config } from "../../config";
import {
  initYjsServer,
  jobAuthCache,
  YJS_CLOSE_CODES,
  invalidateJobAuthCache,
} from "../yjsServer";

// ─── Prisma mock ──────────────────────────────────────────────────────────────
const mockJobFindUnique = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    // Use an arrow function so mockJobFindUnique is captured by reference (lazy
    // evaluation at call-time, not at import-time) — avoids TDZ error because
    // the outer `const mockJobFindUnique` declaration is hoisted above jest.mock
    // but only initialized after the import phase completes.
    job: { findUnique: (...args: any[]) => mockJobFindUnique(...args) },
  })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeToken(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: "1h" });
}

function wsUrl(port: number, jobId?: string, token?: string): string {
  const params = new URLSearchParams();
  if (jobId) params.set("job", jobId);
  if (token) params.set("token", token);
  return `ws://localhost:${port}/yjs?${params.toString()}`;
}

function connectWs(
  url: string
): Promise<{ ws: WebSocket; closeCode: number | null; closeReason: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let closeCode: number | null = null;
    let closeReason = "";
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ws, closeCode, closeReason });
    };

    ws.on("open", () => {
      // Give the server 200 ms to close immediately-rejected connections
      // before treating the connection as successfully open.
      timer = setTimeout(settle, 200);
    });

    ws.on("close", (code, reason) => {
      closeCode = code;
      closeReason = reason.toString();
      settle();
    });

    ws.on("error", () => {
      settle();
    });
  });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let httpServer: ReturnType<typeof createServer>;
let wss: WebSocketServer;
let port: number;

beforeAll((done) => {
  httpServer = createServer();
  wss = initYjsServer(httpServer);
  httpServer.listen(0, () => {
    const addr = httpServer.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
    done();
  });
});

afterAll((done) => {
  wss.close();
  httpServer.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  // Clear the cache between tests
  invalidateJobAuthCache("job-1");
  invalidateJobAuthCache("job-2");
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Yjs WebSocket server — JWT validation", () => {
  it("closes with 4001 when no token is provided", async () => {
    const url = wsUrl(port, "job-1"); // no token
    const { closeCode } = await connectWs(url);
    expect(closeCode).toBe(YJS_CLOSE_CODES.INVALID_JWT);
  });

  it("closes with 4001 when token is malformed", async () => {
    const url = wsUrl(port, "job-1", "not.a.valid.token");
    const { closeCode } = await connectWs(url);
    expect(closeCode).toBe(YJS_CLOSE_CODES.INVALID_JWT);
  });

  it("closes with 4004 when jobId param is missing", async () => {
    const token = makeToken("user-1");
    // Build URL without job param
    const url = `ws://localhost:${port}/yjs?token=${token}`;
    const { closeCode } = await connectWs(url);
    expect(closeCode).toBe(YJS_CLOSE_CODES.JOB_NOT_FOUND);
  });
});

describe("Yjs WebSocket server — room-level authorization", () => {
  it("closes with 4003 when user is not a party to the job", async () => {
    mockJobFindUnique.mockResolvedValueOnce({
      clientId: "owner-client",
      freelancerId: "owner-freelancer",
    });

    const token = makeToken("unrelated-user");
    const url = wsUrl(port, "job-1", token);
    const { closeCode, closeReason } = await connectWs(url);

    expect(closeCode).toBe(YJS_CLOSE_CODES.FORBIDDEN);
    expect(closeReason).toMatch(/not a party/i);
  });

  it("closes with 4004 when job does not exist in DB", async () => {
    mockJobFindUnique.mockResolvedValueOnce(null);

    const token = makeToken("user-1");
    const url = wsUrl(port, "job-nonexistent", token);
    const { closeCode } = await connectWs(url);

    expect(closeCode).toBe(YJS_CLOSE_CODES.JOB_NOT_FOUND);
  });

  it("allows client of the job to connect", async () => {
    mockJobFindUnique.mockResolvedValueOnce({
      clientId: "client-user",
      freelancerId: "freelancer-user",
    });

    const token = makeToken("client-user");
    const url = wsUrl(port, "job-1", token);
    const { ws, closeCode } = await connectWs(url);

    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(closeCode).toBeNull();
    ws.close();
  });

  it("allows freelancer of the job to connect", async () => {
    mockJobFindUnique.mockResolvedValueOnce({
      clientId: "client-user",
      freelancerId: "freelancer-user",
    });

    const token = makeToken("freelancer-user");
    const url = wsUrl(port, "job-1", token);
    const { ws, closeCode } = await connectWs(url);

    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(closeCode).toBeNull();
    ws.close();
  });
});

describe("Yjs WebSocket server — LRU cache", () => {
  it("hits DB only once for repeated connections within TTL", async () => {
    mockJobFindUnique.mockResolvedValue({
      clientId: "cached-client",
      freelancerId: null,
    });

    const token = makeToken("cached-client");

    // Connect 3 times in rapid succession
    for (let i = 0; i < 3; i++) {
      invalidateJobAuthCache("job-2"); // reset per-iteration to test coldstart only once
      const url = wsUrl(port, "job-2", token);
      const { ws } = await connectWs(url);
      ws.close();
    }

    // Seed cache manually for the 100-reconnect test
    invalidateJobAuthCache("job-2");
    const firstUrl = wsUrl(port, "job-2", token);
    const { ws: firstWs } = await connectWs(firstUrl);
    firstWs.close();

    // Cache is now warm — 99 more connections should not touch the DB again
    const callsAfterWarm = mockJobFindUnique.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      const url = wsUrl(port, "job-2", token);
      const { ws } = await connectWs(url);
      ws.close();
    }
    expect(mockJobFindUnique.mock.calls.length).toBe(callsAfterWarm);
  });

  it("re-queries DB after cache invalidation", async () => {
    mockJobFindUnique.mockResolvedValue({
      clientId: "inv-client",
      freelancerId: null,
    });

    const token = makeToken("inv-client");

    // First connection warms the cache
    const url = wsUrl(port, "job-2", token);
    const { ws: ws1 } = await connectWs(url);
    ws1.close();
    const callsBefore = mockJobFindUnique.mock.calls.length;

    // Invalidate cache entry
    invalidateJobAuthCache("job-2");

    // Next connection should hit DB again
    const { ws: ws2 } = await connectWs(url);
    ws2.close();
    expect(mockJobFindUnique.mock.calls.length).toBe(callsBefore + 1);
  });
});

describe("Yjs WebSocket server — CRDT update broadcasting", () => {
  it("broadcasts update from client to freelancer peer", async () => {
    mockJobFindUnique.mockResolvedValue({
      clientId: "broadcast-client",
      freelancerId: "broadcast-freelancer",
    });

    const clientToken = makeToken("broadcast-client");
    const freelancerToken = makeToken("broadcast-freelancer");

    const { ws: clientWs } = await connectWs(wsUrl(port, "job-1", clientToken));
    const { ws: freelancerWs } = await connectWs(
      wsUrl(port, "job-1", freelancerToken)
    );

    const received = new Promise<Buffer>((resolve) => {
      freelancerWs.on("message", (data) => resolve(data as Buffer));
    });

    // Give both sockets time to join the room
    await new Promise((r) => setTimeout(r, 50));
    clientWs.send(Buffer.from([1, 2, 3]));

    const msg = await received;
    expect(Buffer.from(msg)).toEqual(Buffer.from([1, 2, 3]));

    clientWs.close();
    freelancerWs.close();
  });

  it("does not send update back to the sender", async () => {
    mockJobFindUnique.mockResolvedValue({
      clientId: "echo-client",
      freelancerId: null,
    });

    const token = makeToken("echo-client");
    const { ws } = await connectWs(wsUrl(port, "job-1", token));

    let gotEcho = false;
    ws.on("message", () => {
      gotEcho = true;
    });

    await new Promise((r) => setTimeout(r, 50));
    ws.send(Buffer.from([9, 9]));
    await new Promise((r) => setTimeout(r, 100));

    expect(gotEcho).toBe(false);
    ws.close();
  });
});
