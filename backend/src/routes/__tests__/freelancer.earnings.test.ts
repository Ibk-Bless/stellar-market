import express from "express";
import request from "supertest";

// ── Mock auth so the route trusts a fixed userId ──
jest.mock("../../middleware/auth", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "freelancer-1";
    next();
  },
}));

// ── Mock the Horizon reconciliation service ──
jest.mock("../../services/earnings-reconciliation.service", () => ({
  fetchOnChainPayments: jest.fn(),
}));

// ── Mock Prisma ──
jest.mock("@prisma/client", () => {
  const actual = jest.requireActual("@prisma/client") as typeof import("@prisma/client");
  const mockPrisma = {
    user: { findUnique: jest.fn() },
    transaction: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  return {
    ...actual,
    PrismaClient: jest.fn(() => mockPrisma),
  };
});

import { PrismaClient } from "@prisma/client";
import freelancerRouter from "../freelancer.routes";
import { fetchOnChainPayments } from "../../services/earnings-reconciliation.service";

const prismaMock = new PrismaClient() as any;
const fetchOnChainMock = fetchOnChainPayments as jest.Mock;

const app = express();
app.use(express.json());
app.use("/api/freelancers", freelancerRouter);
// Minimal error handler mirroring the app's createError shape.
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.statusCode || 500).json({ error: err.message });
});

const freelancer = {
  id: "freelancer-1",
  role: "FREELANCER",
  walletAddress: "GFREELANCER",
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue(freelancer);
});

describe("GET /api/freelancers/earnings/reconcile", () => {
  it("classifies matched, on-chain-only, and db-only payments", async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        txHash: "HASH_MATCHED",
        jobId: "job-1",
        amount: 100,
        createdAt: new Date("2026-01-10T00:00:00Z"),
        job: { id: "job-1", title: "Build API", category: "Backend", client: { username: "acme" } },
      },
      {
        txHash: "HASH_DB_ONLY",
        jobId: "job-2",
        amount: 50,
        createdAt: new Date("2026-01-12T00:00:00Z"),
        job: { id: "job-2", title: "Frontend", category: "Frontend", client: { username: "acme" } },
      },
    ]);

    fetchOnChainMock.mockResolvedValue([
      { txHash: "HASH_MATCHED", memoJobId: "job-1", amount: 100, assetCode: "XLM", createdAt: "2026-01-10T00:00:00Z", from: "GCLIENT" },
      { txHash: "HASH_ONCHAIN_ONLY", memoJobId: "job-9", amount: 75, assetCode: "XLM", createdAt: "2026-01-11T00:00:00Z", from: "GCLIENT" },
    ]);

    const res = await request(app).get(
      "/api/freelancers/earnings/reconcile?from=2026-01-01&to=2026-01-31",
    );

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      onChainCount: 2,
      dbCount: 2,
      matchedCount: 1,
      onChainOnlyCount: 1,
      dbOnlyCount: 1,
      allMatched: false,
    });
    expect(res.body.matched[0].txHash).toBe("HASH_MATCHED");
    expect(res.body.onChainOnly[0].txHash).toBe("HASH_ONCHAIN_ONLY");
    expect(res.body.onChainOnly[0].horizonUrl).toContain("HASH_ONCHAIN_ONLY");
    expect(res.body.dbOnly[0].txHash).toBe("HASH_DB_ONLY");
  });

  it("matches by memo jobId when tx hashes differ", async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        txHash: "DB_HASH",
        jobId: "job-1",
        amount: 100,
        createdAt: new Date("2026-01-10T00:00:00Z"),
        job: { id: "job-1", title: "Build API", category: "Backend", client: { username: "acme" } },
      },
    ]);
    fetchOnChainMock.mockResolvedValue([
      { txHash: "CHAIN_HASH", memoJobId: "job-1", amount: 100, assetCode: "XLM", createdAt: "2026-01-10T00:00:00Z", from: "GCLIENT" },
    ]);

    const res = await request(app).get("/api/freelancers/earnings/reconcile");

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ matchedCount: 1, onChainOnlyCount: 0, dbOnlyCount: 0, allMatched: true });
  });

  it("returns 502 when Horizon is unreachable", async () => {
    prismaMock.transaction.findMany.mockResolvedValue([]);
    fetchOnChainMock.mockRejectedValue(new Error("horizon down"));

    const res = await request(app).get("/api/freelancers/earnings/reconcile");
    expect(res.status).toBe(502);
  });

  it("rejects from after to with 400", async () => {
    const res = await request(app).get(
      "/api/freelancers/earnings/reconcile?from=2026-02-01&to=2026-01-01",
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-freelancers", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...freelancer, role: "CLIENT" });
    const res = await request(app).get("/api/freelancers/earnings/reconcile");
    expect(res.status).toBe(403);
  });
});

describe("GET /api/freelancers/earnings/export", () => {
  it("returns a downloadable CSV with all required fields", async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        txHash: "HASH_1",
        jobId: "job-1",
        amount: 120.5,
        createdAt: new Date("2026-01-10T00:00:00Z"),
        job: { id: "job-1", title: "Smart Contract, Dev", category: "Smart Contract", client: { username: "acme" } },
      },
    ]);
    fetchOnChainMock.mockResolvedValue([
      { txHash: "HASH_1", memoJobId: "job-1", amount: 120.5, assetCode: "XLM", createdAt: "2026-01-10T00:00:00Z", from: "GCLIENT" },
    ]);

    const res = await request(app).get(
      "/api/freelancers/earnings/export?from=2026-01-01&to=2026-01-31",
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("earnings-2026-01-01-to-2026-01-31.csv");
    const [header, row] = res.text.split("\n");
    expect(header).toBe("date,job_title,client_name,amount_xlm,amount_usd,tx_hash,reconciliation_status");
    // Title contains a comma → must be quoted.
    expect(row).toContain('"Smart Contract, Dev"');
    expect(row).toContain("2026-01-10");
    expect(row).toContain("matched");
  });

  it("marks rows unverified when Horizon is unreachable", async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        txHash: "HASH_1",
        jobId: "job-1",
        amount: 10,
        createdAt: new Date("2026-01-10T00:00:00Z"),
        job: { id: "job-1", title: "Job", category: "X", client: { username: "acme" } },
      },
    ]);
    fetchOnChainMock.mockRejectedValue(new Error("down"));

    const res = await request(app).get("/api/freelancers/earnings/export");
    expect(res.status).toBe(200);
    expect(res.text).toContain("unverified");
  });
});
