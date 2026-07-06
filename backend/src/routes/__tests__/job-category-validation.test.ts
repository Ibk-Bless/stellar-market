import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config";

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ role: "CLIENT", emailVerified: true }),
    },
    job: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  return { PrismaClient: jest.fn(() => mockPrisma) as any };
});

jest.mock("../../lib/cache", () => ({
  cache: jest.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) => fn().then((d) => ({ data: d, hit: false }))),
  invalidateCache: jest.fn(),
  invalidateCacheKey: jest.fn(),
  generateJobsCacheKey: jest.fn(() => "key"),
  generateJobCacheKey: jest.fn(() => "key"),
  generateJobOnChainStatusCacheKey: jest.fn(() => "key"),
}));

jest.mock("../../services/recommendation-queue.service", () => ({
  RecommendationQueueService: { enqueueRebuild: jest.fn() },
}));

jest.mock("../../socket", () => ({ getIo: jest.fn(() => ({ emit: jest.fn() })) }));

import { PrismaClient } from "@prisma/client";
import jobRouter from "../job.routes";
import categoriesRouter from "../categories.routes";

const prismaMock = new PrismaClient() as any;
const jobMock = prismaMock.job;
const userMock = prismaMock.user;

const app = express();
app.use(express.json());
app.use("/api/jobs", jobRouter);
app.use("/api/categories", categoriesRouter);

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";

function authHeader(userId = CLIENT_ID) {
  const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

afterEach(() => jest.clearAllMocks());

// ─── POST /api/jobs — category validation (#799) ──────────────────────────────
describe("POST /api/jobs — category validation (#799)", () => {
  const BASE_BODY = {
    title: "Build a dApp",
    description: "Develop a simple Stellar dApp with escrow support.",
    budget: 500,
    skills: ["Rust"],
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  it("returns 422 InvalidCategory for an unrecognised category string", async () => {
    userMock.findUnique.mockResolvedValueOnce({ role: "CLIENT", emailVerified: true });

    const res = await request(app)
      .post("/api/jobs")
      .set(authHeader())
      .send({ ...BASE_BODY, category: "SmartContract" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("InvalidCategory");
    expect(jobMock.create).not.toHaveBeenCalled();
  });

  it("accepts a canonical category string and creates the job", async () => {
    userMock.findUnique.mockResolvedValueOnce({ role: "CLIENT", emailVerified: true });
    jobMock.create.mockResolvedValueOnce({
      id: "job-1",
      ...BASE_BODY,
      category: "Smart Contract",
      status: "OPEN",
      clientId: CLIENT_ID,
      milestones: [],
      client: { id: CLIENT_ID, username: "alice", avatarUrl: null },
      _count: { applications: 0 },
    });

    const res = await request(app)
      .post("/api/jobs")
      .set(authHeader())
      .send({ ...BASE_BODY, category: "Smart Contract" });

    expect(res.status).toBe(201);
    expect(jobMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Smart Contract" }) }),
    );
  });
});

// ─── PUT /api/jobs/:id — category validation (#799) ──────────────────────────
describe("PUT /api/jobs/:id — category validation (#799)", () => {
  const JOB_ID = "00000000-0000-4000-8000-000000000100";

  it("returns 422 InvalidCategory when updating with an invalid category", async () => {
    jobMock.findFirst.mockResolvedValueOnce({ id: JOB_ID, clientId: CLIENT_ID });

    const res = await request(app)
      .put(`/api/jobs/${JOB_ID}`)
      .set(authHeader())
      .send({ category: "web3-stuff" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("InvalidCategory");
    expect(jobMock.update).not.toHaveBeenCalled();
  });

  it("accepts a canonical category on update", async () => {
    jobMock.findFirst.mockResolvedValueOnce({ id: JOB_ID, clientId: CLIENT_ID });
    jobMock.update.mockResolvedValueOnce({ id: JOB_ID, category: "DevOps", milestones: [] });

    const res = await request(app)
      .put(`/api/jobs/${JOB_ID}`)
      .set(authHeader())
      .send({ category: "DevOps" });

    expect(res.status).toBe(200);
    expect(jobMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "DevOps" }) }),
    );
  });
});

// ─── GET /api/categories (#799) ──────────────────────────────────────────────
describe("GET /api/categories (#799)", () => {
  it("returns the full canonical category list publicly", async () => {
    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain("Smart Contract");
    expect(res.body).toContain("Frontend");
    expect(res.body.length).toBeGreaterThanOrEqual(7);
  });
});
