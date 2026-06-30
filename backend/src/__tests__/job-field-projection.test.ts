/**
 * Tests for issue: "Job search API returns all fields including private client
 * contact data to unauthenticated users"
 *
 * Acceptance criteria:
 *  1. client.email is never returned to non-clients
 *  2. client.walletAddress is not returned to unauthenticated users
 *  3. The client who owns a job receives the full record (minus email)
 *  4. Response shape is validated by a Zod schema before sending
 *
 * Covers both GET /api/jobs  (list)  and  GET /api/jobs/:id  (single).
 */

// ─── Prisma mock ──────────────────────────────────────────────────────────────
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    job: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    savedJob: {
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $disconnect: jest.fn(),
  };

  return {
    PrismaClient: jest.fn(() => mockPrisma) as any,
    UserRole: { CLIENT: "CLIENT", FREELANCER: "FREELANCER", ADMIN: "ADMIN" } as any,
  };
});

// ─── JWT mock ─────────────────────────────────────────────────────────────────
jest.mock("jsonwebtoken", () => ({
  verify: jest.fn(),
  sign: jest.fn().mockReturnValue("mock-token"),
}));

// ─── Config mock ──────────────────────────────────────────────────────────────
jest.mock("../config", () => ({
  config: {
    jwtSecret: "test-secret",
    platformMinBudgetXlm: 1,
  },
  MAX_PAGE_SIZE: 100,
}));

// ─── Cache mock (bypass Redis for tests) ─────────────────────────────────────
jest.mock("../lib/cache", () => ({
  cache: jest.fn((_key: string, _ttl: number, fn: () => Promise<any>) => fn().then((data: any) => ({ data, hit: false }))),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
  invalidateCacheKey: jest.fn().mockResolvedValue(undefined),
  generateJobsCacheKey: jest.fn().mockReturnValue("jobs:list:test"),
  generateJobCacheKey: jest.fn().mockReturnValue("job:test"),
  generateJobOnChainStatusCacheKey: jest.fn().mockReturnValue("job:on-chain:test"),
}));

// ─── ContractService mock ─────────────────────────────────────────────────────
jest.mock("../services/contract.service", () => ({
  ContractService: {
    getOnChainJobStatus: jest.fn().mockResolvedValue("FUNDED"),
    getRevisionProposal: jest.fn().mockResolvedValue(null),
  },
}));

// ─── RecommendationQueueService mock ─────────────────────────────────────────
jest.mock("../services/recommendation-queue.service", () => ({
  RecommendationQueueService: {
    enqueueRebuild: jest.fn().mockResolvedValue(undefined),
  },
}));

import { PrismaClient } from "@prisma/client";
import * as jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import jobRouter from "../routes/job.routes";

const prismaMock = new PrismaClient() as any;
const jwtVerify = jwt.verify as jest.Mock;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CLIENT_ID = "client-001";
const FREELANCER_ID = "freelancer-001";
const JOB_ID = "job-001";

/** Full job object as it comes out of Prisma (includes all sensitive fields). */
const rawJob = {
  id: JOB_ID,
  title: "Build a Soroban dApp",
  description: "Looking for a Stellar expert to build a dApp.",
  budget: 5000,
  category: "Development",
  status: "OPEN",
  clientId: CLIENT_ID,
  freelancerId: null,
  contractJobId: null,
  escrowStatus: "UNFUNDED",
  skills: ["Rust", "Soroban"],
  deadline: new Date("2027-01-01T00:00:00Z"),
  isFlagged: false,
  flagReason: null,
  flaggedAt: null,
  flaggedBy: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  client: {
    id: CLIENT_ID,
    username: "alice",
    avatarUrl: null,
    bio: "Stellar dev",
    // SENSITIVE FIELDS — must be stripped from non-clients
    email: "alice@example.com",
    walletAddress: "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890",
  },
  freelancer: null,
  milestones: [],
  applications: [],
  _count: { applications: 0 },
};

// ─── App factory ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/jobs", jobRouter);
  return app;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Configure jwt.verify to return a specific userId for the next call. */
function mockAuthAs(userId: string, role: "CLIENT" | "FREELANCER" | "ADMIN") {
  jwtVerify.mockReturnValueOnce({ userId });
  prismaMock.user.findUnique.mockResolvedValueOnce({ role, emailVerified: true });
}

afterEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jobs  (list endpoint)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/jobs — field projection", () => {
  // Set up Prisma to return one job for every list query
  beforeEach(() => {
    prismaMock.job.findMany.mockResolvedValue([rawJob]);
    prismaMock.job.count.mockResolvedValue(1);
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("unauthenticated request returns only public fields (no email, no walletAddress)", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/jobs");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    const job = res.body.data[0];

    // Required public fields must be present
    expect(job).toHaveProperty("id");
    expect(job).toHaveProperty("title");
    expect(job).toHaveProperty("description");
    expect(job).toHaveProperty("budget");
    expect(job).toHaveProperty("category");
    expect(job).toHaveProperty("createdAt");
    expect(job).toHaveProperty("client");
    expect(job.client).toHaveProperty("id");
    expect(job.client).toHaveProperty("username");

    // Sensitive fields must be absent
    expect(job.client).not.toHaveProperty("email");
    expect(job.client).not.toHaveProperty("walletAddress");

    // Operational fields not needed for anonymous browse should be absent
    expect(job).not.toHaveProperty("skills");
    expect(job).not.toHaveProperty("status");
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("authenticated non-client request does not include client.email", async () => {
    mockAuthAs(FREELANCER_ID, "FREELANCER");

    const app = buildApp();
    const res = await request(app)
      .get("/api/jobs")
      .set("Authorization", "Bearer mock-token");

    expect(res.status).toBe(200);

    const job = res.body.data[0];

    // email must never be present
    expect(job.client).not.toHaveProperty("email");

    // walletAddress IS allowed for authenticated users
    expect(job.client).toHaveProperty("walletAddress");

    // Operational fields should be present for authenticated callers
    expect(job).toHaveProperty("skills");
    expect(job).toHaveProperty("status");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jobs/:id  (single job endpoint)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/jobs/:id — field projection", () => {
  beforeEach(() => {
    prismaMock.job.findFirst.mockResolvedValue(rawJob);
    // savedJob lookup for freelancers
    prismaMock.savedJob.findUnique.mockResolvedValue(null);
  });

  // ── Test 1 (single) ─────────────────────────────────────────────────────────
  it("unauthenticated request returns only public fields (no email, no walletAddress)", async () => {
    const app = buildApp();
    const res = await request(app).get(`/api/jobs/${JOB_ID}`);

    expect(res.status).toBe(200);

    expect(res.body.client).not.toHaveProperty("email");
    expect(res.body.client).not.toHaveProperty("walletAddress");

    // Basic fields present
    expect(res.body).toHaveProperty("id", JOB_ID);
    expect(res.body).toHaveProperty("title");
    expect(res.body).toHaveProperty("client");
    expect(res.body.client).toHaveProperty("username");
  });

  // ── Test 2 (single) ─────────────────────────────────────────────────────────
  it("authenticated non-client request does not include client.email", async () => {
    mockAuthAs(FREELANCER_ID, "FREELANCER");

    const app = buildApp();
    const res = await request(app)
      .get(`/api/jobs/${JOB_ID}`)
      .set("Authorization", "Bearer mock-token");

    expect(res.status).toBe(200);
    expect(res.body.client).not.toHaveProperty("email");
    // walletAddress is visible to authenticated non-clients
    expect(res.body.client).toHaveProperty("walletAddress");
  });

  // ── Test 3 (single) ─────────────────────────────────────────────────────────
  it("client viewing their own job receives full record minus email", async () => {
    // The job's clientId matches the authenticated user
    mockAuthAs(CLIENT_ID, "CLIENT");

    const app = buildApp();
    const res = await request(app)
      .get(`/api/jobs/${JOB_ID}`)
      .set("Authorization", "Bearer mock-token");

    expect(res.status).toBe(200);

    // email must still be absent even for the owner
    expect(res.body.client).not.toHaveProperty("email");

    // walletAddress is present for the owner
    expect(res.body.client).toHaveProperty("walletAddress");

    // Full operational fields are present
    expect(res.body).toHaveProperty("milestones");
    expect(res.body).toHaveProperty("applications");
    expect(res.body).toHaveProperty("escrowStatus");
    expect(res.body).toHaveProperty("clientId", CLIENT_ID);
  });
});
