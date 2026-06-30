import { PrismaClient } from "@prisma/client";
import RedisClient from "./redis";
import { logger } from "./logger";

/**
 * Token-version helper backing JWT invalidation on password change (issue #787).
 *
 * Every issued access token embeds the user's `tokenVersion` at sign time. When
 * a password changes the column is incremented, so any token carrying an older
 * value is rejected by the auth middleware. The current version is read on every
 * authenticated request, so it is cached in Redis (60s TTL) to keep that lookup
 * off the database hot path.
 */
const prisma = new PrismaClient();

/** Cache lifetime for a user's token version. Short enough that a missed
 *  invalidation still self-heals within a minute. */
const TOKEN_VERSION_TTL_SECONDS = 60;

const cacheKey = (userId: string): string => `auth:tokenVersion:${userId}`;

/**
 * Resolve a user's current token version, served from Redis when warm and
 * falling back to Postgres on a miss (then back-filling the cache).
 *
 * Returns `null` when the user does not exist. Redis failures degrade
 * gracefully to a direct database read so authentication never hard-fails on a
 * cache outage.
 */
export async function getCurrentTokenVersion(userId: string): Promise<number | null> {
  const key = cacheKey(userId);

  try {
    if (!RedisClient.isRedisConnected()) {
      await RedisClient.connect();
    }
    const redis = RedisClient.getInstance();

    const cached = await redis.get(key);
    if (cached !== null) {
      return Number(cached);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    // `tokenVersion` is a NOT NULL column with a default, so a real row always
    // carries it; treat an absent value as "unknown" (fail-open) rather than 0.
    if (!user || user.tokenVersion == null) {
      return null;
    }

    await redis.setex(key, TOKEN_VERSION_TTL_SECONDS, String(user.tokenVersion));
    return user.tokenVersion;
  } catch (err) {
    logger.warn({ err, userId }, "tokenVersion cache error — reading from database");
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    return user && user.tokenVersion != null ? user.tokenVersion : null;
  }
}

/**
 * Drop the cached token version for a user. Call immediately after incrementing
 * `tokenVersion` so the new value is observed without waiting for the TTL.
 */
export async function invalidateTokenVersionCache(userId: string): Promise<void> {
  try {
    if (!RedisClient.isRedisConnected()) {
      await RedisClient.connect();
    }
    await RedisClient.getInstance().del(cacheKey(userId));
  } catch (err) {
    // A stale cache entry expires within 60s, so a failure here is non-fatal.
    logger.warn({ err, userId }, "Failed to invalidate tokenVersion cache");
  }
}
