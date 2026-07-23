import RedisClient from "./redis";
import { logger } from "./logger";

const PRESENCE_TTL_SECONDS = Number(process.env.PRESENCE_TTL_SECONDS || 30);
const PRESENCE_HEARTBEAT_MS = Number(process.env.PRESENCE_HEARTBEAT_MS || 10_000);

const redis = RedisClient.getInstance();

function socketKey(userId: string, socketId: string): string {
  return `presence:socket:${userId}:${socketId}`;
}

function socketSetKey(userId: string): string {
  return `presence:sockets:${userId}`;
}

/**
 * Registers a socket connection in the cluster-wide presence registry.
 * The per-socket key carries a TTL so a crashed instance's connections
 * age out on their own instead of lingering as "online" forever.
 */
export async function markSocketOnline(userId: string, socketId: string): Promise<void> {
  await Promise.all([
    redis.set(socketKey(userId, socketId), "1", "EX", PRESENCE_TTL_SECONDS),
    redis.sadd(socketSetKey(userId), socketId),
  ]);
}

export async function refreshSocketPresence(userId: string, socketId: string): Promise<void> {
  const refreshed = await redis.expire(socketKey(userId, socketId), PRESENCE_TTL_SECONDS);
  if (!refreshed) {
    // TTL already lapsed (e.g. a long GC pause) — recreate it rather than leave the
    // socket set pointing at a key that no longer exists.
    await markSocketOnline(userId, socketId);
  }
}

export async function markSocketOffline(userId: string, socketId: string): Promise<void> {
  await Promise.all([
    redis.del(socketKey(userId, socketId)),
    redis.srem(socketSetKey(userId), socketId),
  ]);
}

/**
 * Cluster-wide online check: true if any of the user's registered sockets
 * still has a live (non-expired) presence key, regardless of which backend
 * instance holds that socket.
 */
export async function isUserOnline(userId: string): Promise<boolean> {
  const socketIds = await redis.smembers(socketSetKey(userId));
  if (socketIds.length === 0) return false;

  const pipeline = redis.pipeline();
  for (const socketId of socketIds) {
    pipeline.exists(socketKey(userId, socketId));
  }
  const results = await pipeline.exec();
  if (!results) return false;

  const stale: string[] = [];
  let online = false;

  results.forEach(([err, exists], index) => {
    if (err) return;
    if (exists) {
      online = true;
    } else {
      stale.push(socketIds[index]);
    }
  });

  if (stale.length > 0) {
    redis.srem(socketSetKey(userId), ...stale).catch((err) => {
      logger.warn({ err, userId }, "Failed to prune stale presence entries");
    });
  }

  return online;
}

/**
 * Keeps a connected socket's presence key from expiring. Cleared on disconnect.
 */
export function startPresenceHeartbeat(userId: string, socketId: string): NodeJS.Timeout {
  return setInterval(() => {
    refreshSocketPresence(userId, socketId).catch((err) => {
      logger.error({ err, userId, socketId }, "Failed to refresh presence heartbeat");
    });
  }, PRESENCE_HEARTBEAT_MS);
}
