import pino from "pino";
import { getRequestId } from "./request-context";

const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin() {
    const requestId = getRequestId();
    return requestId ? { requestId } : {};
  },
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
});

export function installRequestIdConsolePatch(): void {
  return;
}
