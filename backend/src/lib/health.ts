import type { PrismaClient } from "@prisma/client";
import { rpc } from "@stellar/stellar-sdk";
import RedisClient from "./redis";
import { config } from "../config";

export type DependencyHealthStatus = "ok" | "error" | "degraded";
export type HorizonListenerStatus = "connected" | "degraded" | "down";

export type HealthResponse = {
  status: "ok" | "degraded";
  service: "stellarmarket-api";
  uptime?: number;
  checks: {
    database: DependencyHealthStatus;
    redis: DependencyHealthStatus;
    horizonListener: HorizonListenerStatus | DependencyHealthStatus;
  };
};

export async function getHealthStatus(
  prisma: Pick<PrismaClient, "$queryRawUnsafe">,
): Promise<HealthResponse> {
  const checks: HealthResponse["checks"] = {
    database: "ok",
    redis: "ok",
    sorobanRpc: "ok",
    horizonListener: getHorizonListenerHealth(),
  };

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } catch {
    checks.database = "error";
  }

  try {
    if (!RedisClient.isRedisConnected()) {
      await RedisClient.connect();
    }
    await RedisClient.getInstance().ping();
  } catch {
    checks.redis = "error";
  }

  try {
    const server = new rpc.Server(config.stellar.rpcUrl);
    await server.getHealth();
  } catch {
    checks.sorobanRpc = "error";
  }

  // Database and Redis are critical; horizon listener "down" is also critical
  const criticalHealthy =
    checks.database === "ok" &&
    checks.redis === "ok" &&
    checks.horizonListener !== "down";

  return {
    status: criticalHealthy ? "ok" : "degraded",
    uptime: Math.floor(process.uptime()),
    version: config.version,
    checks,
  };
}
