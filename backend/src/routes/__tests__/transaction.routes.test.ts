import request from "supertest";
import express from "express";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetTransaction = jest.fn() as jest.MockedFunction<any>;

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getTransaction: mockGetTransaction,
    })),
    Api: { GetTransactionStatus: { SUCCESS: "SUCCESS", FAILED: "FAILED", NOT_FOUND: "NOT_FOUND" } },
  },
}));

import transactionRoutes from "../transaction.routes";

// Mock Prisma
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    transaction: {
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
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

  describe("GET /api/transactions/:txHash/status", () => {
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    it("returns SUCCESS directly from the DB record without hitting RPC", async () => {
      mockPrisma.transaction.findUnique.mockResolvedValue({
        id: "tx1",
        status: "SUCCESS",
        maxLedger: null,
        confirmedLedger: 12345,
      });

      const response = await request(app).get("/api/transactions/hash123/status");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "SUCCESS", ledger: 12345 });
      expect(mockGetTransaction).not.toHaveBeenCalled();
    });

    it("returns FAILED with canRetry: false from the DB record", async () => {
      mockPrisma.transaction.findUnique.mockResolvedValue({
        id: "tx1",
        status: "FAILED",
        maxLedger: null,
        confirmedLedger: null,
      });

      const response = await request(app).get("/api/transactions/hash123/status");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "FAILED", canRetry: false });
    });

    it("returns 404 when the transaction was never pre-registered", async () => {
      mockPrisma.transaction.findUnique.mockResolvedValue(null);

      const response = await request(app).get("/api/transactions/unknown/status");

      expect(response.status).toBe(404);
    });

    it("marks EXPIRED and returns canRetry: true when the maxTime deadline has passed and RPC reports NOT_FOUND", async () => {
      // maxLedger stores tx.timeBounds.maxTime (Unix seconds), not a ledger
      // sequence number — it must be compared against wall-clock time.
      mockPrisma.transaction.findUnique.mockResolvedValue({
        id: "tx1",
        status: "PENDING",
        maxLedger: nowSeconds() - 100,
        confirmedLedger: null,
      });
      mockGetTransaction.mockResolvedValue({ status: "NOT_FOUND" });

      const response = await request(app).get("/api/transactions/hash123/status");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "EXPIRED", canRetry: true });
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "EXPIRED" } }),
      );
    });

    it("stays PENDING when RPC reports NOT_FOUND but the maxTime deadline is still in the future", async () => {
      mockPrisma.transaction.findUnique.mockResolvedValue({
        id: "tx1",
        status: "PENDING",
        maxLedger: nowSeconds() + 1000,
        confirmedLedger: null,
      });
      mockGetTransaction.mockResolvedValue({ status: "NOT_FOUND" });

      const response = await request(app).get("/api/transactions/hash123/status");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "PENDING" });
      expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
    });

    it("syncs SUCCESS from a live RPC check on a PENDING record", async () => {
      mockPrisma.transaction.findUnique.mockResolvedValue({
        id: "tx1",
        status: "PENDING",
        maxLedger: nowSeconds() + 1000,
        confirmedLedger: null,
      });
      mockGetTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 555 });

      const response = await request(app).get("/api/transactions/hash123/status");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "SUCCESS", ledger: 555 });
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "SUCCESS", confirmedLedger: 555 } }),
      );
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
