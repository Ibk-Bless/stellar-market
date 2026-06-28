import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { Router } from "express";
import { globalRateLimiter, writeRateLimiter } from "../middleware/rate-limit";

jest.mock("../middleware/rate-limit", () => ({
  globalRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  writeRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

function buildApp() {
  const app = express();
  const stubRoutes = Router();
  stubRoutes.get("/jobs", (_req: Request, res: Response) => res.json({ jobs: [] }));

  app.use("/api/v1/jobs", writeRateLimiter);
  app.use("/api/v1", globalRateLimiter);

  app.use("/api/v1", (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-API-Version", "1");
    next();
  });

  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/v1")) return next();
    const deprecationDate = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toUTCString();
    res.setHeader("Deprecation", `date="${deprecationDate}"`);
    res.setHeader("Link", `</api/v1${req.path}>; rel="successor-version"`);
    return res.redirect(301, `/api/v1${req.path}`);
  });

  app.use("/api/v1", stubRoutes);
  return app;
}

describe("API versioning (#802)", () => {
  const app = buildApp();

  it("GET /api/v1/jobs returns 200 with jobs payload", async () => {
    const res = await request(app).get("/api/v1/jobs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobs: [] });
  });

  it("GET /api/v1/* responses include X-API-Version: 1 header", async () => {
    const res = await request(app).get("/api/v1/jobs");
    expect(res.headers["x-api-version"]).toBe("1");
  });

  it("GET /api/jobs redirects to /api/v1/jobs with 301", async () => {
    const res = await request(app).get("/api/jobs").redirects(0);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/api/v1/jobs");
  });

  it("GET /api/jobs redirect includes Deprecation header", async () => {
    const res = await request(app).get("/api/jobs").redirects(0);
    expect(res.headers["deprecation"]).toMatch(/^date="/);
  });

  it("following the redirect from /api/jobs resolves to the same response as /api/v1/jobs", async () => {
    const direct = await request(app).get("/api/v1/jobs");
    const legacy = await request(app).get("/api/jobs").redirects(5);
    expect(legacy.status).toBe(200);
    expect(legacy.body).toEqual(direct.body);
  });
});
