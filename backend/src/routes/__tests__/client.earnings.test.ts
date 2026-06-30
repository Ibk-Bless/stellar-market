import express from "express";
import request from "supertest";

jest.mock("../../middleware/auth", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "client-1";
    next();
  },
}));

jest.mock("@prisma/client", () => {
  const actual = jest.requireActual("@prisma/client") as typeof import("@prisma/client");
  const mockPrisma = {
    user: { findUnique: jest.fn() },
    transaction: { aggregate: jest.fn() },
    $queryRaw: jest.fn(),
  };
  return {
    ...actual,
    PrismaClient: jest.fn(() => mockPrisma),
  };
});

import { PrismaClient } from "@prisma/client";
import clientRouter from "../client.routes";

const prismaMock = new PrismaClient() as any;

const app = express();
app.use(express.json());
app.use("/api/clients", clientRouter);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.statusCode || 500).json({ error: err.message });
});

const client = { id: "client-1", role: "CLIENT" };

const freelancerBreakdownRows = [
  { freelancerId: "f-2", displayName: "bravo", totalPaid: 500, jobCount: 2 },
  { freelancerId: "f-1", displayName: "alpha", totalPaid: 1500, jobCount: 4 },
  { freelancerId: "f-3", displayName: "charlie", totalPaid: 900, jobCount: 1 },
];

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue(client);
  prismaMock.transaction.aggregate
    .mockResolvedValueOnce({ _sum: { amount: 2900 } }) // totalSpent
    .mockResolvedValueOnce({ _sum: { amount: 500 } }); // spentThisMonth
  prismaMock.$queryRaw
    .mockResolvedValueOnce([{ month: "2026-06", spend: 2900 }]) // monthlySpend
    .mockResolvedValueOnce(freelancerBreakdownRows); // freelancerBreakdown (query already orders DESC)
});

describe("GET /api/clients/earnings", () => {
  it("returns the freelancer breakdown sorted by totalPaid descending", async () => {
    const res = await request(app).get("/api/clients/earnings");

    expect(res.status).toBe(200);
    const totals = res.body.freelancerBreakdown.map((f: any) => f.totalPaid);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(res.body.freelancerBreakdown[0]).toMatchObject({ freelancerId: "f-1", totalPaid: 1500 });
  });

  it("includes summary totals and monthly spend series", async () => {
    const res = await request(app).get("/api/clients/earnings");

    expect(res.body.summary).toMatchObject({ totalSpent: 2900, spentThisMonth: 500 });
    expect(res.body.monthlySpend).toEqual([{ month: "2026-06", spend: 2900 }]);
  });

  it("returns 403 for non-clients", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...client, role: "FREELANCER" });
    const res = await request(app).get("/api/clients/earnings");
    expect(res.status).toBe(403);
  });
});
