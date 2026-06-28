import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { createServer } from "http";
import { PrismaClient } from "@prisma/client";
import { config } from "./config";
import routes from "./routes";
import { globalRateLimiter, writeRateLimiter } from "./middleware/rate-limit";
import { sanitizeInput } from "./middleware/sanitize";
import { errorHandler } from "./middleware/error";
import { requestIdMiddleware } from "./middleware/request-id";
import { requestTimeoutMiddleware } from "./middleware/timeout";
import { initSocket } from "./socket";
import { initYjsServer } from "./socket/yjsServer";
import { startExpiryJob } from "./jobs/expiry.job";
import { startPendingTxJob } from "./jobs/pending-tx.job";
import { startEscrowTtlJob } from "./jobs/escrow-ttl.job";
import {
  startHorizonListener,
  stopHorizonListener,
} from "./services/horizon-listener.service";
import { installRequestIdConsolePatch, logger } from "./lib/logger";
import { connectWithRetry } from "./lib/db-connect";
import { getHealthStatus } from "./lib/health";
import { RecommendationQueueService } from "./services/recommendation-queue.service";
import { initializeVirusScanner } from "./utils/virusScanner";
import { ReputationCacheService } from "./services/reputation-cache.service";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { notificationQueue, stopNotificationWorker } from "./lib/notification-queue";
import { requireAdmin } from "./middleware/auth";

const app = express();
import { swaggerUi, swaggerSpec } from "./config/swagger";
const httpServer = createServer(app);

// Pool metrics tracked via middleware (Prisma JS client does not expose pool internals)
const poolMetrics = { active: 0, waiting: 0, exhaustedCount: 0 };

const prisma = new PrismaClient({
  datasources: {
    db: {
      // connection_limit should be set in DATABASE_URL query string, e.g.:
      // postgresql://user:pass@host/db?connection_limit=10&pool_timeout=10
      // We honour the env var as-is; the pool_metrics middleware tracks exhaustion.
      url: process.env.DATABASE_URL,
    },
  },
});

prisma.$use(async (params, next) => {
  if (params.model === "Job") {
    if (params.action === "findUnique" || params.action === "findFirst" || params.action === "findMany" || params.action === "count") {
      if (!params.args) params.args = {};
      const where = params.args.where || {};
      if (where.deletedAt === undefined) {
        where.deletedAt = null;
        params.args.where = where;
      }
    }
  }
  return next(params);
});

// Detect Prisma connection-pool exhaustion (P2024) and alert
prisma.$use(async (params, next) => {
  poolMetrics.active += 1;
  try {
    const result = await next(params);
    return result;
  } catch (err: any) {
    if (err?.code === "P2024") {
      poolMetrics.exhaustedCount += 1;
      logger.error(
        { err, model: params.model, action: params.action },
        "Connection pool exhausted — consider increasing connection_limit in DATABASE_URL",
      );
    }
    throw err;
  } finally {
    poolMetrics.active -= 1;
  }
});

installRequestIdConsolePatch();

// Attach Socket.io
initSocket(httpServer);
// Attach Yjs WebSocket server (milestone negotiation rooms)
initYjsServer(httpServer);

const isDevelopment =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

const corsOptions: cors.CorsOptions = {
  credentials: true,
  origin: (origin, callback) => {
    // Allow requests with no Origin header (same-origin, curl, Postman)
    if (!origin) {
      return callback(null, true);
    }

    // In development: allow any localhost origin dynamically
    if (isDevelopment && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // Check against the explicit allowlist
    if (config.corsAllowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Reject — log at warn level with CORS_REJECTED marker
    logger.warn(
      { origin, allowedOrigins: config.corsAllowedOrigins },
      "CORS_REJECTED",
    );
    // Return null (no CORS headers) rather than an error object —
    // the browser will block the request; we do not send a 403 response
    // body for preflight requests as that breaks the CORS protocol.
    return callback(null, false);
  },
};

// Security middleware
app.use(helmet());

// Swagger UI setup (disabled in production)
if (process.env.NODE_ENV !== "production") {
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api/openapi.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
}
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(requestIdMiddleware);
app.use(requestTimeoutMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(sanitizeInput);

// Health check
app.get("/health", async (_req, res) => {
  const health = await getHealthStatus(prisma);
  const httpStatus = health.checks.database === "error" || health.checks.redis === "error"
    ? 503
    : 200;
  res.status(httpStatus).json(health);
});

// Metrics endpoint — exposes pool stats and process counters
app.get("/metrics", (_req, res) => {
  res.json({
    db_pool_size: poolMetrics.active,
    db_pool_waiting: poolMetrics.waiting,
    db_pool_exhausted_total: poolMetrics.exhaustedCount,
    process_uptime_seconds: Math.floor(process.uptime()),
    process_memory_rss_bytes: process.memoryUsage().rss,
  });
});

// Database-only health probe (used by some platforms/LB checks)
app.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    res.status(200).json({ status: "ok" });
  } catch (error) {
    logger.error({ err: error }, "Database health probe failed");
    res.status(503).json({ status: "error" });
  }
});

// Bull Board — queue dashboard (admin-gated)
const bullBoardAdapter = new ExpressAdapter();
bullBoardAdapter.setBasePath("/admin/queues");
createBullBoard({
  queues: [new BullMQAdapter(notificationQueue)],
  serverAdapter: bullBoardAdapter,
});
app.use("/admin/queues", requireAdmin, bullBoardAdapter.getRouter());

// Rate limiting (route-specific auth limiters are applied in auth router)

// Write rate limiting (applied before routes for POST mutations)
app.use("/api/v1/jobs", writeRateLimiter);
app.use("/api/v1/reviews", writeRateLimiter);
app.use("/api/v1/disputes", writeRateLimiter);

// Global rate limiting (skip auth routes already limited)
app.use("/api/v1", globalRateLimiter);

// Add API version header to all versioned responses
app.use("/api/v1", (_req, res, next) => {
  res.setHeader("X-API-Version", "1");
  next();
});

// Legacy /api/* redirect — clients have 6 months to migrate to /api/v1/*
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/v1")) {
    return next();
  }
  const deprecationDate = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toUTCString();
  res.setHeader("Deprecation", `date="${deprecationDate}"`);
  res.setHeader("Link", `</api/v1${req.path}>; rel="successor-version"`);
  return res.redirect(301, `/api/v1${req.path}${req.search || ""}`);
});

// API routes
app.use("/api/v1", routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: "NOT_FOUND",
    message: "Route not found.",
    requestId: req.requestId,
  });
});

// Error handler
app.use(errorHandler);

async function startServer(): Promise<void> {
  await connectWithRetry(prisma);
  httpServer.listen(config.port, async () => {
    logger.info({ port: config.port }, "StellarMarket API running");
    startExpiryJob();
    startPendingTxJob();
    startEscrowTtlJob();
    startHorizonListener();
    RecommendationQueueService.startWorker();

    // Initialize virus scanner (non-blocking)
    await initializeVirusScanner();

    // Warm reputation cache and start periodic refresh
    logger.info("Initializing reputation cache...");
    await ReputationCacheService.warmCache();
    ReputationCacheService.startPeriodicRefresh();
  });
}

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down gracefully");

  stopHorizonListener();
  RecommendationQueueService.stopWorker();
  ReputationCacheService.stopPeriodicRefresh();
  await stopNotificationWorker();

  const { NotificationService } =
    await import("./services/notification.service");
  await NotificationService.flushAllBatches();

  httpServer.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

if (require.main === module) {
  startServer().catch((err) => {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  });
}

export { app, httpServer, startServer };
