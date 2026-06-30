import { Request, Response, NextFunction } from "express";
import prometheus from "prom-client";

const register = new prometheus.Registry();

prometheus.collectDefaultMetrics({ register });

const httpRequestDuration = new prometheus.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

const dbPoolSize = new prometheus.Gauge({
  name: "db_pool_size",
  help: "Size of the database connection pool",
  registers: [register],
});

const poolSize = parseInt(process.env.DATABASE_POOL_SIZE || "10", 10);
dbPoolSize.set(poolSize);

export function requestDurationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path === "/health" || req.path === "/metrics") {
    next();
    return;
  }

  const end = httpRequestDuration.startTimer();

  res.on("finish", () => {
    const route = (req.route?.path || req.path).replace(/\/api/, "");
    end({ method: req.method, route, status_code: res.statusCode });
  });

  next();
}

export async function metricsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
}
