export function logError(error: Error, context?: string) {
  console.error(`[${context ?? "Error"}]:`, error);

  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_DSN) {
    try {
      const Sentry = require("@sentry/react");
      Sentry.captureException(error, { tags: { context: context ?? "unknown" } });
    } catch {
      // @sentry/react not installed
    }
  }
}
