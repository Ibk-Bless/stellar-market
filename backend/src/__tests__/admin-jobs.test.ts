/**
 * Integration tests for GET /api/admin/jobs
 *
 * Covers issue #456: getJobsAdminQuerySchema was missing from the admin routes
 * import, causing a runtime ReferenceError on any call to GET /api/admin/jobs.
 * These tests assert that the route resolves with a 200 and a well-formed
 * pagination envelope, and that the schema import is wired correctly.
 */

// ─── Prisma mock ─────────────────────────────────────────────────────────────
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    job: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    dispute: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $disconnect: jest.fn(),
  };

  return {
    PrismaClient: jest.fn(() => mockPrisma) as any,
    UserRole: { CLIENT: "CLIENT", FREELANCER: "FREELANCER", ADMIN: "ADMIN" } as any,
    DisputeStatus: { OPEN: "OPEN", IN_PROGRESS: "IN_PROGRESS", RESOLVED: "RESOLVED" } as any,
  };
});

// ─── JWT / auth mock ──────────────────────────────────────────────────────────
jest.mock("jsonwebtoken", () => ({
  verify: jest.fn().mockReturnValue({ userId: "admin-user-id" }),
  sign: jest.fn().mockReturnValue("mock-token"),
}));

// ─── Config mock (jwtSecret needed by auth middleware) ────────────────────────
jest.mock("../config", () => ({
  config: {
    jwtSecret: "test-secret",
    stellar: {
      rpcUrl: "https://soroban-testnet.stellar.org",
      escrowContractId: "",
      disputeContractId: "",
      reputationContractId: "",
    },
    smtp: {
      host: "smtp.test",
      port: 587,
      user: "",
      pass: "",
      from: "noreply@test.io",
    },
  },
}));

// ─── Notification service mock ────────────────────────────────────────────────
jest.mock("../services/notification.service", () => ({
  NotificationService: {
    sendNotification: jest.fn().mockResolvedValue(undefined),
  },
}));

// ─── Audit logger mock ────────────────────────────────────────────────────────
jest.mock("../utils/auditLogger", () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import adminRouter from "../routes/admin";

const prismaMock = new PrismaClient() as any;

// ─── Minimal Express app for testing ─────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

// Helper: attach admin auth header to every supertest request
function asAdmin(req: request.Test): request.Test {
  // Ensure prisma returns an ADMIN user for requireAdmin's DB lookup
  prismaMock.user.findUnique.mockResolvedValueOnce({ role: "ADMIN" });
  return req.set("Authorization", "Bearer mock-admin-token");
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────
const mockJob = {
  id: "job-001",
  title: "Build a dApp",
  description: "Full-stack Stellar dApp",
  budget: 5000,
  category: "Development",
  status: "OPEN",
  clientId: "client-001",
  freelancerId: null,
  deletedAt: null,
  isFlagged: false,
  flagReason: null,
  flaggedAt: null,
  flaggedBy: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  client: { id: "client-001", username: "alice", email: "alice@example.com" },
  freelancer: null,
  _count: { applications: 3, milestones: 2 },
};

afterEach(() => jest.clearAllMocks());

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("GET /api/admin/jobs", () => {
  it("returns 200 with pagination fields on a normal request", async () => {
    prismaMock.job.findMany.mockResolvedValueOnce([mockJob]);
    prismaMock.job.count.mockResolvedValueOnce(1);

    const app = buildApp();
    const res = await asAdmin(request(app).get("/api/admin/jobs"));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("jobs");
    expect(Array.isArray(res.body.jobs)).toBe(true);
    expect(res.body).toHaveProperty("pagination");
    expect(res.body.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: expect.any(Number),
      totalPages: 1,
    });
  });

  it("respects page and limit query parameters", async () => {
    prismaMock.job.findMany.mockResolvedValueOnce([mockJob]);
    prismaMock.job.count.mockResolvedValueOnce(50);

    const app = buildApp();
    const res = await asAdmin(request(app).get("/api/admin/jobs?page=2&limit=10"));

    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.limit).toBe(10);
    expect(res.body.pagination.totalPages).toBe(5);
  });

  it("returns empty jobs array when no jobs exist", async () => {
    prismaMock.job.findMany.mockResolvedValueOnce([]);
    prismaMock.job.count.mockResolvedValueOnce(0);

    const app = buildApp();
    const res = await asAdmin(request(app).get("/api/admin/jobs"));

    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.totalPages).toBe(0);
  });

  it("excludes deleted jobs by default", async () => {
    prismaMock.job.findMany.mockResolvedValueOnce([]);
    prismaMock.job.count.mockResolvedValueOnce(0);

    const app = buildApp();
    await asAdmin(request(app).get("/api/admin/jobs"));

    // The where clause passed to findMany should filter out deleted jobs
    const findManyCall = prismaMock.job.findMany.mock.calls[0][0];
    expect(findManyCall.where).toMatchObject({ deletedAt: null });
  });

  it("includes deleted jobs when includeDeleted=true", async () => {
    const deletedJob = { ...mockJob, deletedAt: new Date() };
    prismaMock.job.findMany.mockResolvedValueOnce([deletedJob]);
    prismaMock.job.count.mockResolvedValueOnce(1);

    const app = buildApp();
    const res = await asAdmin(request(app).get("/api/admin/jobs?includeDeleted=true"));

    expect(res.status).toBe(200);
    // When includeDeleted is true, the where clause should NOT contain deletedAt: null
    const findManyCall = prismaMock.job.findMany.mock.calls[0][0];
    expect(findManyCall.where).not.toMatchObject({ deletedAt: null });
  });

  it("returns 500 when the database throws", async () => {
    prismaMock.job.findMany.mockRejectedValueOnce(new Error("DB connection lost"));

    const app = buildApp();
    const res = await asAdmin(request(app).get("/api/admin/jobs"));

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});
