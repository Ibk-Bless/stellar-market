import { Request, Response, NextFunction } from "express";
import RedisClient from "../lib/redis";
import { logger } from "../lib/logger";

const IDEMPOTENCY_TTL = 24 * 60 * 60;

const IN_FLIGHT_TTL = 30;

export function idempotency(options: { ttl?: number } = {}) {
  const ttl = options.ttl ?? IDEMPOTENCY_TTL;

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers["idempotency-key"] as string | undefined;

    if (!key) {
      next();
      return;
    }

    const redisKey = `idempotency:${key}`;

    try {
      if (!RedisClient.isRedisConnected()) {
        await RedisClient.connect();
      }
      const redis = RedisClient.getInstance();

      const existing = await redis.get(redisKey);
      if (existing) {
        const parsed = JSON.parse(existing);
        if (parsed.status === "in_flight") {
          res.status(409).json({
            code: "CONFLICT",
            error: "Request is already being processed.",
            requestId: req.requestId,
          });
          return;
        }
        res.status(200).json(parsed.response);
        return;
      }

      await redis.setex(redisKey, IN_FLIGHT_TTL, JSON.stringify({ status: "in_flight" }));

      const originalJson = res.json.bind(res);
      res.json = function (body: unknown) {
        redis
          .setex(redisKey, ttl, JSON.stringify({ status: "completed", response: body }))
          .catch((err) =>
            logger.warn({ err, redisKey }, "Failed to store idempotency key"),
          );
        return originalJson(body);
      };

      next();
    } catch (error) {
      logger.warn({ err: error, redisKey }, "Idempotency check failed, proceeding without protection");
      next();
    }
  };
}
