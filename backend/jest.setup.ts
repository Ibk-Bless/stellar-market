// Jest setup file — intentionally minimal

// ─── src/config/redis ────────────────────────────────────────────────────────
// Prevent Redis TCP connections during tests.
//
// auth.2fa.test.ts (and other auth tests) import auth.routes.ts which imports
// rate-limit.ts which calls getRedisClient() at module level. getRedisClient()
// launches a real ioredis connection that retries with delays (200ms, 400ms,
// 800ms). Those deferred retry rejections fire during later test files and
// jest catches them as blank-error failures in whatever test happens to be
// running at that moment (e.g. transaction.routes.test.ts).
//
// Returning null here makes every rate-limiter fall back to MemoryStore and
// stops any TCP connection from being opened during the test run.
jest.mock("./src/config/redis", () => ({
  getRedisClient: jest.fn().mockReturnValue(null),
  RECOMMENDATION_CACHE_PREFIX: "recommendations:",
  RECOMMENDATION_CACHE_TTL: 600,
}));

// ─── src/lib/redis ───────────────────────────────────────────────────────────
// RedisClient is a singleton that opens a real ioredis TCP connection when
// getInstance() is first called. Modules like notification-queue.ts,
// recommendation-queue.service.ts, auth.routes.ts, and report.routes.ts call
// getInstance() at module-load time (top-level), which triggers a real
// connection attempt (ECONNREFUSED) even in tests that don't need Redis.
//
// We replace the entire module with a no-op mock that satisfies all call sites
// without opening any network connections.
const mockRedisInstance = {
  // ioredis command stubs used by notification-queue worker
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  rpush: jest.fn().mockResolvedValue(1),
  lpop: jest.fn().mockResolvedValue(null),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue("OK"),
  del: jest.fn().mockResolvedValue(1),
  hget: jest.fn().mockResolvedValue(null),
  hset: jest.fn().mockResolvedValue(1),
  // ioredis event emitter stubs (BullMQ calls .on internally)
  on: jest.fn().mockReturnThis(),
  once: jest.fn().mockReturnThis(),
  off: jest.fn().mockReturnThis(),
  emit: jest.fn(),
  // connection lifecycle
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue("OK"),
  disconnect: jest.fn(),
  status: "ready",
};

jest.mock("./src/lib/redis", () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn().mockReturnValue(mockRedisInstance),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isRedisConnected: jest.fn().mockReturnValue(false),
  },
}));

// ─── src/lib/notification-queue ──────────────────────────────────────────────
// notification-queue.ts constructs a real BullMQ Queue (and connects to Redis)
// at module load time via `new Queue("notifications", { connection })`.
// Any test file that transitively imports a route or service touching this
// module would trigger the connection. We replace the whole module with stubs.
jest.mock("./src/lib/notification-queue", () => ({
  notificationQueue: {
    add: jest.fn().mockResolvedValue(undefined),
    getFailed: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  },
  startNotificationWorker: jest.fn(),
  stopNotificationWorker: jest.fn().mockResolvedValue(undefined),
  getDlqJobs: jest.fn().mockResolvedValue([]),
  getNotificationPriority: jest.fn().mockReturnValue(3),
  NotificationPriority: {
    CRITICAL: 1,
    HIGH: 2,
    NORMAL: 3,
    LOW: 4,
  },
}));
