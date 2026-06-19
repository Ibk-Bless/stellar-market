import request from "supertest";
import express from "express";
import transactionRoutes from "../transaction.routes";

// Mock Prisma
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    transaction: {
      create: jest.fn(),
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    job: {
      findUnique: jest.fn(),
    },
    milestone: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  return {
    PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
    __mockPrisma: mockPrisma, // Export for test access
  };
});

// Mock auth middleware
jest.mock("../../middleware/auth", () => ({
  authenticate: jest.fn((req, res, next) => {
    req.userId = "user123";
    next();
  }),
}));

// Get the mock prisma instance
const { __mockPrisma: mockPrisma } = jest.requireMock("@prisma/client") as any;

const app = express();
app.use(express.json());
app.use("/api/transactions", transactionRoutes);

describe("Transaction Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/transactions", () => {
    it("should create a new transaction", async () => {
      const mockJob = { id: "job123", title: "Test Job" };
      const mockTransaction = {
        id: "tx123",
        jobId: "job123",
        milestoneId: null,
        fromAddress: "GTEST123",
        toAddress: "GTEST456",
        amount: 100,
        tokenAddress: "GTOKEN",
        txHash: "hash123",
        type: "DEPOSIT",
        status: "SUCCESS",
        createdAt: new Date(),
        job: mockJob,
        milestone: null,
      };

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);
      mockPrisma.transaction.upsert.mockResolvedValue(mockTransaction);

      const response = await request(app).post("/api/transactions").send({
        jobId: "job123",
        fromAddress: "GTEST123",
        toAddress: "GTEST456",
        amount: 100,
        tokenAddress: "GTOKEN",
        txHash: "hash123",
        type: "DEPOSIT",
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id", "tx123");
      expect(response.body).toHaveProperty("txHash", "hash123");
    });

    it("should return 404 if job not found", async () => {
      mockPrisma.job.findUnique.mockResolvedValue(null);

      const response = await request(app).post("/api/transactions").send({
        jobId: "invalid",
        fromAddress: "GTEST123",
        toAddress: "GTEST456",
        amount: 100,
        tokenAddress: "GTOKEN",
        txHash: "hash123",
        type: "DEPOSIT",
      });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error", "Job not found");
    });

    it("should return 201 and promote a PENDING pre-registration to SUCCESS on duplicate txHash", async () => {
      const mockJob = { id: "job123", title: "Test Job" };
      const promotedTx = {
        id: "tx123",
        jobId: "job123",
        milestoneId: null,
        fromAddress: "GTEST123",
        toAddress: "GTEST456",
        amount: 100,
        tokenAddress: "GTOKEN",
        txHash: "hash123",
        type: "DEPOSIT",
        status: "SUCCESS",
        createdAt: new Date(),
        job: mockJob,
        milestone: null,
      };

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);
      // Upsert returns the promoted record regardless of whether it was pre-existing
      mockPrisma.transaction.upsert.mockResolvedValue(promotedTx);

      const response = await request(app).post("/api/transactions").send({
        jobId: "job123",
        fromAddress: "GTEST123",
        toAddress: "GTEST456",
        amount: 100,
        tokenAddress: "GTOKEN",
        txHash: "hash123",
        type: "DEPOSIT",
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("status", "SUCCESS");
      expect(response.body).toHaveProperty("txHash", "hash123");
    });
  });

  describe("GET /api/transactions", () => {
    it("should list transactions for authenticated user", async () => {
      const mockUser = {
        id: "user123",
        walletAddress: "GTEST123",
      };
      const mockTransactions = [
        {
          id: "tx1",
          fromAddress: "GTEST123",
          toAddress: "GTEST456",
          amount: 100,
          type: "DEPOSIT",
          createdAt: new Date(),
          job: { id: "job1", title: "Job 1" },
          milestone: null,
        },
      ];

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrisma.transaction.count.mockResolvedValue(1);

      const response = await request(app).get("/api/transactions");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("transactions");
      expect(response.body).toHaveProperty("pagination");
      expect(response.body.transactions).toHaveLength(1);
    });

    it("should filter transactions by type", async () => {
      const mockUser = {
        id: "user123",
        walletAddress: "GTEST123",
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.transaction.count.mockResolvedValue(0);

      const response = await request(app)
        .get("/api/transactions")
        .query({ type: "RELEASE" });

      expect(response.status).toBe(200);
      expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: "RELEASE",
          }),
        }),
      );
    });

    it("should filter transactions by date range", async () => {
      const mockUser = {
        id: "user123",
        walletAddress: "GTEST123",
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.transaction.count.mockResolvedValue(0);

      const response = await request(app).get("/api/transactions").query({
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
      });

      expect(response.status).toBe(200);
      expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe("GET /api/transactions/job/:jobId", () => {
    it("should get transactions for a specific job", async () => {
      const mockJob = {
        id: "job123",
        clientId: "user123",
        freelancerId: "user456",
      };
      const mockTransactions = [
        {
          id: "tx1",
          jobId: "job123",
          amount: 100,
          type: "DEPOSIT",
          milestone: { id: "m1", title: "Milestone 1", order: 1 },
        },
      ];

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);
      mockPrisma.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrisma.transaction.count.mockResolvedValue(1);

      const response = await request(app).get("/api/transactions/job/job123");

      expect(response.status).toBe(200);
      expect(response.body.transactions).toHaveLength(1);
    });

    it("should return 404 if job not found", async () => {
      mockPrisma.job.findUnique.mockResolvedValue(null);

      const response = await request(app).get("/api/transactions/job/invalid");

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error", "Job not found");
    });

    it("should return 403 if user does not have access", async () => {
      const mockJob = {
        id: "job123",
        clientId: "other1",
        freelancerId: "other2",
      };

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);

      const response = await request(app).get("/api/transactions/job/job123");

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty("error", "Access denied");
    });
  });

  describe("GET /api/transactions/:txHash", () => {
    it("should get transaction by txHash", async () => {
      const mockUser = {
        id: "user123",
        walletAddress: "GTEST123",
      };
      const mockTransaction = {
        id: "tx123",
        txHash: "hash123",
        fromAddress: "GTEST123",
        toAddress: "GTEST456",
        amount: 100,
        job: {
          id: "job123",
          title: "Test Job",
          clientId: "user123",
          freelancerId: "user456",
        },
        milestone: null,
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.transaction.findUnique.mockResolvedValue(mockTransaction);

      const response = await request(app).get("/api/transactions/hash123");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("txHash", "hash123");
    });

    it("should return 404 if transaction not found", async () => {
      mockPrisma.transaction.findUnique.mockResolvedValue(null);

      const response = await request(app).get("/api/transactions/invalid");

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error", "Transaction not found");
    });
  });

  describe("GET /api/transactions/summary/stats", () => {
    it("should get transaction summary for user", async () => {
      const mockUser = {
        id: "user123",
        walletAddress: "GTEST123",
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.transaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 500 } }) // earned
        .mockResolvedValueOnce({ _sum: { amount: 200 } }); // spent

      mockPrisma.transaction.groupBy.mockResolvedValue([
        { type: "DEPOSIT", _count: { type: 2 } },
        { type: "RELEASE", _count: { type: 3 } },
      ]);

      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          id: "tx1",
          amount: 100,
          type: "RELEASE",
          createdAt: new Date(),
          job: { id: "job1", title: "Job 1" },
        },
      ]);

      const response = await request(app).get(
        "/api/transactions/summary/stats",
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("totalEarned", 500);
      expect(response.body).toHaveProperty("totalSpent", 200);
      expect(response.body).toHaveProperty("netBalance", 300);
      expect(response.body).toHaveProperty("transactionsByType");
      expect(response.body).toHaveProperty("recentTransactions");
    });
  });
});
