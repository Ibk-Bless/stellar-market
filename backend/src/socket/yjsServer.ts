import { IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { config } from "../config";

const prisma = new PrismaClient();

// ─── Close code taxonomy ──────────────────────────────────────────────────────
export const YJS_CLOSE_CODES = {
  INVALID_JWT: 4001,
  FORBIDDEN: 4003,
  JOB_NOT_FOUND: 4004,
} as const;

// ─── Simple LRU Cache (max 500, TTL 5 min) ───────────────────────────────────
// Implemented without external dependencies.
interface CacheEntry {
  value: { clientId: string; freelancerId: string | null };
  expiresAt: number;
}

class LRUCache {
  private readonly max: number;
  private readonly ttl: number; // ms
  private readonly map: Map<string, CacheEntry>;

  constructor(max: number, ttlMs: number) {
    this.max = max;
    this.ttl = ttlMs;
    this.map = new Map();
  }

  get(key: string): { clientId: string; freelancerId: string | null } | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh order (LRU: move to end)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: { clientId: string; freelancerId: string | null }): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      // Evict the oldest entry (first key in insertion order)
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttl });
  }

  invalidate(key: string): void {
    this.map.delete(key);
  }
}

export const jobAuthCache = new LRUCache(500, 1000 * 60 * 5);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractJobId(url: string | undefined): string | null {
  if (!url) return null;
  try {
    // URL may be a path like /yjs?job=abc123
    const parsed = new URL(url, "http://localhost");
    return parsed.searchParams.get("job");
  } catch {
    return null;
  }
}

function extractUserIdFromJWT(
  authHeader: string | undefined
): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  const token = parts.length === 2 && parts[0] === "Bearer" ? parts[1] : parts[0];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
    return decoded.userId ?? null;
  } catch {
    return null;
  }
}

async function resolveJobParties(
  jobId: string
): Promise<{ clientId: string; freelancerId: string | null } | null> {
  // Check cache first
  const cached = jobAuthCache.get(jobId);
  if (cached !== undefined) return cached;

  // DB lookup
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { clientId: true, freelancerId: true },
  });

  if (!job) return null;

  const entry = { clientId: job.clientId, freelancerId: job.freelancerId };
  jobAuthCache.set(jobId, entry);
  return entry;
}

// Call this when a job's freelancerId changes (e.g. on application acceptance)
// so stale auth data is evicted immediately.
export function invalidateJobAuthCache(jobId: string): void {
  jobAuthCache.invalidate(jobId);
}

// ─── Yjs document store (in-memory, one doc per job) ─────────────────────────
// In a production Yjs setup you would use y-leveldb or y-mongodb-provider.
// Here we store a minimal state vector per room so existing clients can
// perform an initial sync when a new peer joins.
const roomClients = new Map<string, Set<WebSocket>>();

function broadcastUpdate(
  update: Buffer,
  jobId: string,
  sender: WebSocket
): void {
  const room = roomClients.get(jobId);
  if (!room) return;
  for (const client of room) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(update);
    }
  }
}

// ─── Main setup ───────────────────────────────────────────────────────────────

export function initYjsServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Attach to the HTTP server upgrade event so we can share the same port
  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "", `http://${req.headers.host}`);
    if (pathname !== "/yjs") return; // only handle /yjs upgrades

    wss.handleUpgrade(req, socket as never, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on(
    "connection",
    async (ws: WebSocket, req: IncomingMessage): Promise<void> => {
      // ── 1. JWT validation ─────────────────────────────────────────────────
      const authHeader =
        (req.headers["authorization"] as string | undefined) ??
        extractTokenFromUrl(req.url);

      const userId = extractUserIdFromJWT(authHeader);
      if (!userId) {
        ws.close(YJS_CLOSE_CODES.INVALID_JWT, "Missing or invalid JWT");
        return;
      }

      // ── 2. Extract jobId ──────────────────────────────────────────────────
      const jobId = extractJobId(req.url);
      if (!jobId) {
        ws.close(YJS_CLOSE_CODES.JOB_NOT_FOUND, "Missing job parameter");
        return;
      }

      // ── 3. Room-level authorization ───────────────────────────────────────
      let job: { clientId: string; freelancerId: string | null } | null;
      try {
        job = await resolveJobParties(jobId);
      } catch {
        ws.close(YJS_CLOSE_CODES.JOB_NOT_FOUND, "Job lookup failed");
        return;
      }

      if (!job) {
        ws.close(YJS_CLOSE_CODES.JOB_NOT_FOUND, "Job not found");
        return;
      }

      if (job.clientId !== userId && job.freelancerId !== userId) {
        ws.close(YJS_CLOSE_CODES.FORBIDDEN, "Not a party to this job");
        return;
      }

      // ── 4. Join room ──────────────────────────────────────────────────────
      if (!roomClients.has(jobId)) {
        roomClients.set(jobId, new Set());
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      roomClients.get(jobId)!.add(ws);

      // ── 5. Per-message sender verification ───────────────────────────────
      ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
        const update = Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);

        // The first byte of every Yjs sync message encodes the message type.
        // We read the origin from the second byte range when provided.
        // For our purposes: any binary message is treated as a CRDT update and
        // broadcast to all other peers in the room after origin verification.
        // The origin is passed as a trailing JSON metadata frame by the client:
        //   [<yjs-binary-update> | <json-metadata-frame>]
        // We split on the last null byte (0x00) delimiter.
        const nullIdx = findLastNullByte(update);
        let origin: string | null = null;
        let yjsPayload: Buffer = update;

        if (nullIdx !== -1) {
          try {
            const meta = JSON.parse(
              update.slice(nullIdx + 1).toString("utf8")
            ) as { origin?: string };
            origin = meta.origin ?? null;
            yjsPayload = update.slice(0, nullIdx);
          } catch {
            // Metadata frame missing or malformed — treat entire buffer as Yjs
          }
        }

        if (origin !== null && origin !== userId) {
          console.warn(
            `[yjsServer] Rejected CRDT update from unexpected origin. userId=${userId} origin=${origin} jobId=${jobId}`
          );
          return; // drop — do not broadcast
        }

        broadcastUpdate(yjsPayload, jobId, ws);
      });

      // ── 6. Cleanup on disconnect ──────────────────────────────────────────
      ws.on("close", () => {
        const room = roomClients.get(jobId);
        if (room) {
          room.delete(ws);
          if (room.size === 0) {
            roomClients.delete(jobId);
          }
        }
      });
    }
  );

  return wss;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Allow token in URL query param as fallback: ?token=<jwt> */
function extractTokenFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, "http://localhost");
    const t = parsed.searchParams.get("token");
    return t ? `Bearer ${t}` : undefined;
  } catch {
    return undefined;
  }
}

function findLastNullByte(buf: Buffer): number {
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i] === 0x00) return i;
  }
  return -1;
}
