import express from "express";
import request from "supertest";

// Mock auth middleware
jest.mock("../../middleware/auth", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "freelancer-1";
    next();
  },
}));

// Mock Prisma
jest.mock("@prisma/client", () => {
  const actual = jest.requireActual("@prisma/client") as typeof import("@prisma/client");
  const mockPrisma = {
    user: { findUnique: jest.fn() },
    transaction: { aggregate: jest.fn() },
    job: { count: jest.fn() },
  };
  return {
    ...actual,
    PrismaClient: jest.fn(() => mockPrisma),
  };
});

import { PrismaClient } from "@prisma/client";
import freelancerRouter from "../freelancer.routes";

const prismaMock = new PrismaClient() as any;

const app = express();
app.use(express.json());
app.use("/api/freelancers", freelancerRouter);

const freelancer = {
  id: "freelancer-1",
  role: "FREELANCER",
  walletAddress: "GFREELANCER",
  averageRating: 4.8,
  reviewCount: 12,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/freelancers/me/stats", () => {
  it("returns calculated stats for a valid freelancer", async () => {
    prismaMock.user.findUnique.mockResolvedValue(freelancer);
    
    prismaMock.transaction.aggregate.mockResolvedValue({
      _sum: { amount: 1500.5 },
    });
    
    // First call is completed jobs, second is active jobs
    prismaMock.job.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2);

    const res = await request(app).get("/api/freelancers/me/stats");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalEarnedXlm: 1500.5,
      completedJobs: 5,
      activeJobs: 2,
      averageRating: 4.8,
      reviewCount: 12,
    });

    expect(prismaMock.transaction.aggregate).toHaveBeenCalledWith({
      where: {
        toAddress: "GFREELANCER",
        type: { in: ["RELEASE", "DISPUTE_PAYOUT"] },
      },
      _sum: { amount: true },
    });

    expect(prismaMock.job.count).toHaveBeenNthCalledWith(1, {
      where: { freelancerId: "freelancer-1", status: "COMPLETED" },
    });
    expect(prismaMock.job.count).toHaveBeenNthCalledWith(2, {
      where: { freelancerId: "freelancer-1", status: "IN_PROGRESS" },
    });
  });

  it("returns 0 for earnings if wallet address is missing", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...freelancer,
      walletAddress: null,
    });
    
    prismaMock.job.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const res = await request(app).get("/api/freelancers/me/stats");

    expect(res.status).toBe(200);
    expect(res.body.totalEarnedXlm).toBe(0);
    expect(prismaMock.transaction.aggregate).not.toHaveBeenCalled();
  });

  it("returns 403 if user is not a freelancer", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...freelancer,
      role: "CLIENT",
    });

    const res = await request(app).get("/api/freelancers/me/stats");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Only freelancers can access stats");
  });

  it("returns 403 if user is not found", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).get("/api/freelancers/me/stats");

    expect(res.status).toBe(403);
  });
});
