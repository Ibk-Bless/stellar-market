import express from "express";
import request from "supertest";
import { globalRateLimiter, loginRateLimiter } from "../middleware/rate-limit";

jest.mock("../config/redis", () => ({
  getRedisClient: jest.fn(() => null),
}));

jest.mock("../lib/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
  installRequestIdConsolePatch: jest.fn(),
}));

describe("Rate Limiting", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe("Global Rate Limiter", () => {
    beforeEach(() => {
      app.get("/api/test", globalRateLimiter, (_req, res) => {
        res.json({ message: "success" });
      });
    });

    it("should allow requests within limit (100 req/min)", async () => {
      for (let i = 0; i < 100; i++) {
        const response = await request(app).get("/api/test");
        expect(response.status).toBe(200);
      }
    });

    it("should return 429 after exceeding limit", async () => {
      // Make 101 requests (exceeds limit of 100)
      const responses = await Promise.all(
        Array.from({ length: 101 }, () => request(app).get("/api/test"))
      );

      // First 100 should succeed
      for (let i = 0; i < 100; i++) {
        expect(responses[i].status).toBe(200);
      }

      // 101st should be rate limited
      expect(responses[100].status).toBe(429);
      expect(responses[100].body).toEqual({ error: "Too many requests" });
      expect(responses[100].headers["retry-after"]).toBeDefined();
    });

    it("should whitelist health check paths", async () => {
      app.get("/health", globalRateLimiter, (_req, res) => {
        res.json({ status: "ok" });
      });

      app.get("/health/db", globalRateLimiter, (_req, res) => {
        res.json({ status: "ok" });
      });

      // Make 200 requests to /health (should all succeed)
      for (let i = 0; i < 200; i++) {
        const response = await request(app).get("/health");
        expect(response.status).toBe(200);
      }

      // Make 200 requests to /health/db (should all succeed)
      for (let i = 0; i < 200; i++) {
        const response = await request(app).get("/health/db");
        expect(response.status).toBe(200);
      }
    });

    it("should include Retry-After header in 429 response", async () => {
      // Make 101 requests
      await Promise.all(Array.from({ length: 100 }, () => request(app).get("/api/test")));
      const response = await request(app).get("/api/test");

      expect(response.status).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
      const retryAfter = parseInt(response.headers["retry-after"] as string);
      expect(retryAfter).toBeGreaterThan(0);
    });
  });

  describe("Auth Rate Limiter", () => {
    beforeEach(() => {
      app.post("/api/auth/login", loginRateLimiter, (_req, res) => {
        res.json({ message: "login success" });
      });

      app.post("/api/auth/register", loginRateLimiter, (_req, res) => {
        res.json({ message: "register success" });
      });
    });

    it("should allow 10 requests per minute for auth endpoints", async () => {
      for (let i = 0; i < 10; i++) {
        const response = await request(app).post("/api/auth/login");
        expect(response.status).toBe(200);
      }
    });

    it("should block auth endpoints after 10 rapid attempts", async () => {
      // Make 11 requests (exceeds limit of 10)
      const responses = await Promise.all(
        Array.from({ length: 11 }, () => request(app).post("/api/auth/login"))
      );

      // First 10 should succeed
      for (let i = 0; i < 10; i++) {
        expect(responses[i].status).toBe(200);
      }

      // 11th should be rate limited
      expect(responses[10].status).toBe(429);
      expect(responses[10].body).toEqual({ error: "Too many requests" });
    });

    it("should include Retry-After header in auth 429 response", async () => {
      // Make 11 requests
      await Promise.all(Array.from({ length: 10 }, () => request(app).post("/api/auth/login")));
      const response = await request(app).post("/api/auth/login");

      expect(response.status).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
      const retryAfter = parseInt(response.headers["retry-after"] as string);
      expect(retryAfter).toBeGreaterThan(0);
    });
  });
});
