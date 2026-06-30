import { Request, Response } from "express";
import rateLimit, { MemoryStore } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { getRedisClient } from "../config/redis";

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const WRITE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

type RateLimitedRequest = Request & { userId?: string; rateLimit?: { resetTime?: Date } };

const sendTooManyRequests = (req: RateLimitedRequest, res: Response): void => {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfterSeconds = resetTime
    ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
    : Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

  res.setHeader("Retry-After", retryAfterSeconds.toString());
  res.status(429).json({ error: "Too many requests" });
};

const sendTooManyWrites = (req: RateLimitedRequest, res: Response): void => {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfterSeconds = resetTime
    ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
    : Math.ceil(WRITE_RATE_LIMIT_WINDOW_MS / 1000);

  res.setHeader("Retry-After", retryAfterSeconds.toString());
  res.status(429).json({ error: "Too many write requests" });
};

// Redis store configuration
const redisClient = getRedisClient();
const redisStore = redisClient
  ? new RedisStore({
      sendCommand: (...args: string[]) =>
        (redisClient as any).call(args[0], ...args.slice(1)),
      prefix: "rate_limit:",
    })
  : undefined;

// When no Redis is configured, use explicit in-memory stores so they can be reset in tests
const globalStore = redisStore ?? new MemoryStore();
const loginStore = redisStore ? new RedisStore({ sendCommand: (...args: string[]) => (redisClient as any).call(args[0], ...args.slice(1)), prefix: "rate_limit_login:" }) : new MemoryStore();
const registerStore = redisStore ? new RedisStore({ sendCommand: (...args: string[]) => (redisClient as any).call(args[0], ...args.slice(1)), prefix: "rate_limit_register:" }) : new MemoryStore();
const forgotStore = redisStore ? new RedisStore({ sendCommand: (...args: string[]) => (redisClient as any).call(args[0], ...args.slice(1)), prefix: "rate_limit_forgot:" }) : new MemoryStore();
const writeStore = redisStore ? new RedisStore({ sendCommand: (...args: string[]) => (redisClient as any).call(args[0], ...args.slice(1)), prefix: "rate_limit_write:" }) : new MemoryStore();

export const globalRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 100, // 100 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  store: globalStore,
  passOnStoreError: true,
  handler: sendTooManyRequests,
  skip: (req: Request) => {
    // Whitelist health-check paths
    return req.path === "/health" || req.path === "/health/db";
  },
});

export const loginRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 10, // 10 req/min for auth endpoints
  standardHeaders: true,
  legacyHeaders: false,
  store: loginStore,
  passOnStoreError: true,
  handler: sendTooManyRequests,
});

export const registerRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 10, // 10 req/min for auth endpoints
  standardHeaders: true,
  legacyHeaders: false,
  store: registerStore,
  passOnStoreError: true,
  handler: sendTooManyRequests,
});

export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  store: forgotStore,
  passOnStoreError: true,
  handler: sendTooManyRequests,
});

export const writeRateLimiter = rateLimit({
  windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: writeStore,
  passOnStoreError: true,
  keyGenerator: (req: Request) => {
    const rateLimitedReq = req as RateLimitedRequest;
    if (rateLimitedReq.userId) return String(rateLimitedReq.userId);
    // Normalize IPv6-mapped IPv4 (::ffff:x.x.x.x) to avoid dual-stack bypass
    const ip = (req.ip ?? req.socket?.remoteAddress ?? "unknown").replace(/^::ffff:/i, "");
    return ip;
  },
  validate: { ip: false }, // IP is normalized in keyGenerator above
  skip: (req: Request) => req.method !== "POST",
  handler: sendTooManyWrites,
});

export async function resetAllRateLimiters(): Promise<void> {
  const stores = [globalStore, loginStore, registerStore, forgotStore, writeStore];
  await Promise.all(stores.map((s) => (s as MemoryStore).resetAll?.()));
}
