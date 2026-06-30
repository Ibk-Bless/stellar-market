import { logger } from "./logger";
import type { ApiError } from "../middleware/error";

export type UpstreamErrorCode = "HorizonUnavailable" | "OracleUnavailable";

/** Default bound for a single outbound Horizon / Soroban RPC call. */
export const UPSTREAM_TIMEOUT_MS = 10_000;

export class UpstreamTimeoutError extends Error implements ApiError {
  statusCode = 502;

  constructor(public code: UpstreamErrorCode) {
    super(code);
    this.name = "UpstreamTimeoutError";
  }
}

/**
 * Bounds a Horizon / Soroban RPC call with an AbortController so a slow or
 * unresponsive upstream can't hold the caller's connection open indefinitely.
 * On expiry, rejects with an `UpstreamTimeoutError` (502) carrying `code` so
 * route handlers and the global error handler can return a structured body.
 */
export async function withUpstreamTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: {
    route: string;
    target: string;
    code?: UpstreamErrorCode;
    timeoutMs?: number;
  },
): Promise<T> {
  const { route, target, code = "HorizonUnavailable", timeoutMs = UPSTREAM_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const startedAt = Date.now();

  let timer!: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      logger.warn(
        { route, target, durationMs: Date.now() - startedAt, code },
        "Upstream call timed out",
      );
      reject(new UpstreamTimeoutError(code));
    }, timeoutMs);
  });

  try {
    // Races the upstream call against the deadline — the SDK call isn't
    // guaranteed to honor `signal` (Stellar SDK clients don't), so the
    // race is what actually enforces the bound; the signal is passed
    // through for callers that can use it to abort their own fetch.
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}
