import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
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
      client: redisClient,
      prefix: "rate_limit:",
    })
  : undefined;

export const globalRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 100, // 100 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
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
  store: redisStore,
  passOnStoreError: true,
  handler: sendTooManyRequests,
});

export const registerRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 10, // 10 req/min for auth endpoints
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  passOnStoreError: true,
  handler: sendTooManyRequests,
});

export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  passOnStoreError: true,
  handler: sendTooManyRequests,
});

export const writeRateLimiter = rateLimit({
  windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  passOnStoreError: true,
  keyGenerator: (req: Request) => {
    const rateLimitedReq = req as RateLimitedRequest;
    return rateLimitedReq.userId || req.ip || "unknown";
  },
  skip: (req: Request) => req.method !== "POST",
  handler: sendTooManyWrites,
});
