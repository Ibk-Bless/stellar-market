import { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";

/**
 * Global request timeout: if a route hasn't responded within this window
 * (e.g. it is stuck waiting on a slow/unresponsive Horizon RPC call), the
 * connection is closed and a 503 is returned instead of holding the
 * connection — and its slot in the pool — open indefinitely.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

export function requestTimeoutMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = Date.now();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;

    logger.warn(
      {
        route: req.originalUrl,
        method: req.method,
        durationMs: Date.now() - startedAt,
        target: "stellar-market-api",
        requestId: req.requestId,
      },
      "Request timed out",
    );

    if (!res.headersSent) {
      res.status(503).json({ error: "RequestTimeout", requestId: req.requestId });
    } else {
      res.end();
    }
  }, REQUEST_TIMEOUT_MS);

  res.once("finish", () => clearTimeout(timer));
  res.once("close", () => clearTimeout(timer));

  // Expose for downstream handlers that want to bail out early.
  Object.defineProperty(req, "timedout", {
    get: () => timedOut,
    configurable: true,
  });

  next();
}
