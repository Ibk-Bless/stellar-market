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
const prisma = new PrismaClient();

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

installRequestIdConsolePatch();

// Attach Socket.io
initSocket(httpServer);
// Attach Yjs WebSocket server (milestone negotiation rooms)
initYjsServer(httpServer);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || origin === config.frontendUrl) {
      callback(null, true);
      return;
    }

    callback(new Error("Not allowed by CORS"));
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
app.use("/api/jobs", writeRateLimiter);
app.use("/api/reviews", writeRateLimiter);
app.use("/api/disputes", writeRateLimiter);

// Global rate limiting (skip auth routes already limited)
app.use("/api", globalRateLimiter);

// API routes
app.use("/api", routes);

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

function startServer(): void {
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
  startServer();
}

export { app, httpServer, startServer };
