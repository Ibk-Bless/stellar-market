import { DisputeService } from "../services/dispute.service";
import { ContractService } from "../services/contract.service";

jest.mock("../services/contract.service", () => ({
  ContractService: {
    getOnChainAssignedArbitrators: jest.fn(),
  },
}));

// Local runtime-friendly enums for tests (use string literals to avoid TS value/type mismatch
// when importing generated Prisma types). This keeps tests stable and avoids relying on the
// runtime shape of @prisma/client exports during TypeScript compile.
const DisputeStatus = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
} as const;

const JobStatus = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  DISPUTED: "DISPUTED",
} as const;

// ─── Prisma mock ─────────────────────────────────────────────────────────────
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    job: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    dispute: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    disputeVote: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $disconnect: jest.fn(),
  };

  return {
    PrismaClient: jest.fn(() => mockPrisma) as any,
    DisputeStatus: {
      OPEN: "OPEN",
      IN_PROGRESS: "IN_PROGRESS",
      RESOLVED: "RESOLVED",
    } as any,
    JobStatus: {
      OPEN: "OPEN",
      IN_PROGRESS: "IN_PROGRESS",
      COMPLETED: "COMPLETED",
      CANCELLED: "CANCELLED",
      DISPUTED: "DISPUTED",
    } as any,
    EscrowStatus: {
      UNFUNDED: "UNFUNDED",
      FUNDED: "FUNDED",
      COMPLETED: "COMPLETED",
      CANCELLED: "CANCELLED",
      DISPUTED: "DISPUTED",
    } as any,
  };
});

import { PrismaClient } from "@prisma/client";
const prismaMock = new PrismaClient() as any;

// ─── Test data ────────────────────────────────────────────────────────────────
const clientId = "00000000-0000-4000-8000-000000000001";
const freelancerId = "00000000-0000-4000-8000-000000000002";
const voterId = "00000000-0000-4000-8000-000000000003";
const jobId = "00000000-0000-4000-8000-000000000100";
const disputeId = "00000000-0000-4000-8000-000000000200";

const mockClient = {
  id: clientId,
  username: "testclient",
  walletAddress: "GCLIENT123",
  avatarUrl: null,
};

const mockFreelancer = {
  id: freelancerId,
  username: "testfreelancer",
  walletAddress: "GFREELANCER123",
  avatarUrl: null,
};

const mockJob = {
  id: jobId,
  title: "Test Job",
  description: "Test description",
  budget: 1000,
  category: "Development",
  clientId,
  freelancerId,
  status: JobStatus.IN_PROGRESS,
  escrowStatus: "FUNDED",
  client: mockClient,
  freelancer: mockFreelancer,
};

const mockDispute = {
  id: disputeId,
  jobId,
  clientId,
  freelancerId,
  initiatorId: clientId,
  reason: "The freelancer did not deliver the work as agreed",
  status: DisputeStatus.OPEN,
  outcome: null,
  resolvedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  job: { title: mockJob.title, budget: mockJob.budget },
  client: mockClient,
  freelancer: mockFreelancer,
  initiator: mockClient,
};

afterEach(() => jest.resetAllMocks());

describe("Dispute Management System", () => {
  describe("createDispute", () => {
    it("should create a dispute successfully", async () => {
      prismaMock.job.findUnique.mockResolvedValueOnce(mockJob);
      prismaMock.dispute.findUnique.mockResolvedValueOnce(null);
      prismaMock.dispute.create.mockResolvedValueOnce(mockDispute);
      prismaMock.job.update.mockResolvedValueOnce({
        ...mockJob,
        status: JobStatus.DISPUTED,
      });

      const dispute = await DisputeService.createDispute(
        jobId,
        clientId,
        "The freelancer did not deliver the work as agreed",
      );

      expect(dispute).toBeDefined();
      expect(dispute.jobId).toBe(jobId);
      expect(dispute.clientId).toBe(clientId);
      expect(dispute.freelancerId).toBe(freelancerId);
      expect(dispute.initiatorId).toBe(clientId);
      expect(dispute.status).toBe(DisputeStatus.OPEN);
      expect(prismaMock.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: jobId },
          data: expect.objectContaining({ status: JobStatus.DISPUTED }),
        }),
      );
    });

    it("should prevent duplicate disputes on the same job", async () => {
      prismaMock.job.findUnique.mockResolvedValueOnce(mockJob);
      prismaMock.dispute.findUnique.mockResolvedValueOnce(mockDispute);

      await expect(
        DisputeService.createDispute(
          jobId,
          freelancerId,
          "Another dispute reason",
        ),
      ).rejects.toThrow("A dispute already exists for this job");
    });

    it("should reject dispute from non-participant", async () => {
      prismaMock.job.findUnique.mockResolvedValueOnce(mockJob);

      await expect(
        DisputeService.createDispute(jobId, voterId, "I want to dispute this"),
      ).rejects.toThrow("Not a participant of this job");
    });

    it("should reject dispute for job without freelancer", async () => {
      prismaMock.job.findUnique.mockResolvedValueOnce({
        ...mockJob,
        freelancer: null,
        freelancerId: null,
      });

      await expect(
        DisputeService.createDispute(jobId, clientId, "No freelancer assigned"),
      ).rejects.toThrow(
        "Job must have an assigned freelancer to raise a dispute",
      );
    });
  });

  describe("getDisputeById", () => {
    it("should retrieve dispute with full details", async () => {
      const fullDispute = {
        ...mockDispute,
        votes: [],
        attachments: [],
      };
      prismaMock.dispute.findUnique.mockResolvedValueOnce(fullDispute);

      const dispute = await DisputeService.getDisputeById(disputeId);

      expect(dispute).toBeDefined();
      expect(dispute.id).toBe(disputeId);
      expect(prismaMock.dispute.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: disputeId } }),
      );
    });

    it("should throw error for non-existent dispute", async () => {
      prismaMock.dispute.findUnique.mockResolvedValueOnce(null);

      await expect(
        DisputeService.getDisputeById("non-existent-id"),
      ).rejects.toThrow("Dispute not found");
    });

    it("should retrieve on-chain arbitrators and join user profiles if profile exists", async () => {
      const fullDispute = {
        ...mockDispute,
        onChainDisputeId: "12345",
        votes: [],
        attachments: [],
      };
      prismaMock.dispute.findUnique.mockResolvedValueOnce(fullDispute);
      (ContractService.getOnChainAssignedArbitrators as jest.Mock).mockResolvedValueOnce(["GARBITRATOR123"]);
      prismaMock.user.findFirst.mockResolvedValueOnce({
        username: "arb_user",
        avatarUrl: "http://example.com/avatar.png",
      });

      const dispute = await DisputeService.getDisputeById(disputeId);

      expect(dispute.arbitrators).toEqual([
        {
          address: "GARBITRATOR123",
          displayName: "arb_user",
          avatarUrl: "http://example.com/avatar.png",
        },
      ]);
    });

    it("should retrieve on-chain arbitrators and fallback to truncated address if profile does not exist", async () => {
      const fullDispute = {
        ...mockDispute,
        onChainDisputeId: "12345",
        votes: [],
        attachments: [],
      };
      prismaMock.dispute.findUnique.mockResolvedValueOnce(fullDispute);
      (ContractService.getOnChainAssignedArbitrators as jest.Mock).mockResolvedValueOnce(["GARBITRATOR123"]);
      prismaMock.user.findFirst.mockResolvedValueOnce(null);

      const dispute = await DisputeService.getDisputeById(disputeId);

      expect(dispute.arbitrators).toEqual([
        {
          address: "GARBITRATOR123",
          displayName: "GARB...R123",
          avatarUrl: null,
        },
      ]);
    });
  });

  describe("getDisputes", () => {
    it("should return paginated disputes", async () => {
      prismaMock.dispute.findMany.mockResolvedValueOnce([mockDispute]);
      prismaMock.dispute.count.mockResolvedValueOnce(1);

      const result = await DisputeService.getDisputes(
        {},
        { page: 1, limit: 10 },
      );

      expect(result.disputes).toBeDefined();
      expect(Array.isArray(result.disputes)).toBe(true);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(1);
    });

    it("should filter disputes by status", async () => {
      prismaMock.dispute.findMany.mockResolvedValueOnce([mockDispute]);
      prismaMock.dispute.count.mockResolvedValueOnce(1);

      await DisputeService.getDisputes(
        { status: DisputeStatus.OPEN },
        { page: 1, limit: 10 },
      );

      expect(prismaMock.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: DisputeStatus.OPEN },
        }),
      );
    });
  });

  describe("castVote", () => {
    const mockVote = {
      id: "vote-id",
      disputeId,
      voterId,
      choice: "CLIENT",
      reason: "Valid concerns",
      createdAt: new Date(),
      voter: {
        id: voterId,
        username: "testvoter",
        walletAddress: "GVOTER123",
        avatarUrl: null,
      },
    };

    it("should cast a vote successfully", async () => {
      prismaMock.dispute.findUnique.mockResolvedValueOnce(mockDispute);
      prismaMock.disputeVote.findUnique.mockResolvedValueOnce(null);
      prismaMock.disputeVote.create.mockResolvedValueOnce(mockVote);
      prismaMock.dispute.update.mockResolvedValueOnce({
        ...mockDispute,
        status: DisputeStatus.IN_PROGRESS,
      });

      const vote = await DisputeService.castVote(
        disputeId,
        voterId,
        "CLIENT",
        "The client has valid concerns",
      );

      expect(vote).toBeDefined();
      expect(vote.disputeId).toBe(disputeId);
      expect(vote.voterId).toBe(voterId);
      expect(vote.choice).toBe("CLIENT");
    });

    it("should prevent duplicate votes", async () => {
      prismaMock.dispute.findUnique.mockResolvedValueOnce(mockDispute);
      prismaMock.disputeVote.findUnique.mockResolvedValueOnce(mockVote);

      await expect(
        DisputeService.castVote(
          disputeId,
          voterId,
          "FREELANCER",
          "Changed my mind",
        ),
      ).rejects.toThrow("You have already voted on this dispute");
    });

    it("should prevent participants from voting", async () => {
      prismaMock.dispute.findUnique.mockResolvedValueOnce(mockDispute);

      await expect(
        DisputeService.castVote(
          disputeId,
          clientId,
          "CLIENT",
          "I vote for myself",
        ),
      ).rejects.toThrow("Dispute participants cannot vote");
    });

    it("should prevent voting on resolved dispute", async () => {
      prismaMock.dispute.findUnique.mockResolvedValueOnce({
        ...mockDispute,
        status: DisputeStatus.RESOLVED,
      });

      await expect(
        DisputeService.castVote(disputeId, voterId, "CLIENT", "Late vote"),
      ).rejects.toThrow("Cannot vote on a resolved dispute");
    });
  });

  describe("getVoteStats", () => {
    it("should return accurate vote statistics", async () => {
      prismaMock.disputeVote.findMany.mockResolvedValueOnce([
        { choice: "CLIENT" },
        { choice: "CLIENT" },
        { choice: "FREELANCER" },
      ]);

      const stats = await DisputeService.getVoteStats(disputeId);

      expect(stats).toBeDefined();
      expect(stats.total).toBe(3);
      expect(stats.votesForClient).toBe(2);
      expect(stats.votesForFreelancer).toBe(1);
    });
  });

  describe("resolveDispute", () => {
    it("should resolve dispute successfully", async () => {
      const resolvedDispute = {
        ...mockDispute,
        status: DisputeStatus.RESOLVED,
        outcome: "Resolved in favor of client",
        resolvedAt: new Date(),
        votes: [],
      };
      prismaMock.dispute.findUnique.mockResolvedValueOnce({
        ...mockDispute,
        votes: [],
      });
      prismaMock.dispute.update.mockResolvedValueOnce(resolvedDispute);
      prismaMock.job.update.mockResolvedValueOnce({
        ...mockJob,
        status: JobStatus.COMPLETED,
      });

      const dispute = await DisputeService.resolveDispute(
        disputeId,
        "Resolved in favor of client based on community vote",
      );

      expect(dispute).toBeDefined();
      expect(dispute.status).toBe(DisputeStatus.RESOLVED);
      expect(dispute.outcome).toBe("Resolved in favor of client");
      expect(dispute.resolvedAt).toBeDefined();
    });

    it("should prevent resolving already resolved dispute", async () => {
      prismaMock.dispute.findUnique.mockResolvedValueOnce({
        ...mockDispute,
        status: DisputeStatus.RESOLVED,
      });

      await expect(
        DisputeService.resolveDispute(disputeId, "Trying to resolve again"),
      ).rejects.toThrow("Dispute is already resolved");
    });
  });

  describe("processWebhook", () => {
    it("should process DISPUTE_RAISED webhook", async () => {
      prismaMock.dispute.update.mockResolvedValueOnce({
        ...mockDispute,
        onChainDisputeId: "12345",
      });

      const result = await DisputeService.processWebhook({
        type: "DISPUTE_RAISED",
        disputeId,
        onChainDisputeId: "12345",
      });

      expect(result.success).toBe(true);
      expect(prismaMock.dispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: disputeId },
          data: { onChainDisputeId: "12345" },
        }),
      );
    });

    it("should handle unknown webhook type", async () => {
      await expect(
        DisputeService.processWebhook({
          type: "UNKNOWN_TYPE" as any,
          disputeId: "test",
        }),
      ).rejects.toThrow("Unknown webhook type");
    });
  });
});
