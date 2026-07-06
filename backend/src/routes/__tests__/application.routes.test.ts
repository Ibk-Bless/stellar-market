import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config";
import applicationRouter from "../application.routes";

// ─── Prisma & NotificationService mocks ───────────────────────────────────────
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    job: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    application: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000001",
        role: "CLIENT",
        emailVerified: true,
        walletAddress: "GDTESTWALLETADDRESS000000000000000000000000000000000000000",
      }),
    },
  };

  return {
    PrismaClient: jest.fn(() => mockPrisma) as any,
    NotificationType: {
      JOB_APPLIED: "JOB_APPLIED",
      APPLICATION_ACCEPTED: "APPLICATION_ACCEPTED",
    } as any,
  };
});

jest.mock("../../services/notification.service", () => ({
  NotificationService: {
    sendNotification: jest.fn().mockResolvedValue({ id: "mock-notif-id" }),
  },
}));

jest.mock("../../services/recommendation.service", () => ({
  RecommendationService: {
    invalidateUserRecommendations: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../lib/token-version", () => ({
  getCurrentTokenVersion: jest.fn().mockResolvedValue(null),
  invalidateTokenVersionCache: jest.fn().mockResolvedValue(undefined),
}));

import { PrismaClient } from "@prisma/client";
const prismaMock = new PrismaClient() as any;
const jobMock = prismaMock.job;
const applicationMock = prismaMock.application;
const userMock = prismaMock.user;

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use("/api", applicationRouter);

// ─── Stable test UUIDs (RFC 4122 v4 format) ──────────────────────────────────
const JOB_ID = "00000000-0000-4000-8000-000000000100";
const CLIENT_A_ID = "00000000-0000-4000-8000-000000000001";
const CLIENT_B_ID = "00000000-0000-4000-8000-000000000002";

function authHeader(userId = CLIENT_A_ID) {
  const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

afterEach(() => jest.clearAllMocks());

describe("GET /api/jobs/:jobId/applications", () => {
  it("returns 401 with no auth token", async () => {
    const res = await request(app).get(`/api/jobs/${JOB_ID}/applications`);
    expect(res.status).toBe(401);
  });

  it("returns 404 when job does not exist", async () => {
    jobMock.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .get(`/api/jobs/${JOB_ID}/applications`)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Job not found." });
    expect(jobMock.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: JOB_ID },
        select: { clientId: true },
      }),
    );
    expect(applicationMock.findMany).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated user is not job owner", async () => {
    jobMock.findUnique.mockResolvedValueOnce({ clientId: CLIENT_B_ID });

    const res = await request(app)
      .get(`/api/jobs/${JOB_ID}/applications`)
      .set(authHeader(CLIENT_A_ID));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "Not authorized to view applicants for this job.",
    });
    expect(applicationMock.findMany).not.toHaveBeenCalled();
  });

  it("returns applicants list when authenticated user is job owner", async () => {
    jobMock.findUnique.mockResolvedValueOnce({ clientId: CLIENT_A_ID });
    applicationMock.findMany.mockResolvedValueOnce([
      {
        id: "00000000-0000-4000-8000-000000000200",
        jobId: JOB_ID,
        freelancerId: "00000000-0000-4000-8000-000000000300",
        proposal: "x".repeat(60),
        estimatedDuration: 7,
        bidAmount: 100,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        freelancer: {
          id: "00000000-0000-4000-8000-000000000300",
          username: "freelancer",
          avatarUrl: null,
          bio: "bio",
        },
      },
    ]);
    applicationMock.count.mockResolvedValueOnce(1);

    const res = await request(app)
      .get(`/api/jobs/${JOB_ID}/applications`)
      .set(authHeader(CLIENT_A_ID));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 1,
      page: 1,
      totalPages: 1,
    });
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(applicationMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: JOB_ID },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 10,
      }),
    );
  });
});

describe("POST /api/jobs/:jobId/apply", () => {
  it("returns 400 when user tries to apply to their own job", async () => {
    jobMock.findUnique.mockResolvedValueOnce({
      id: JOB_ID,
      clientId: CLIENT_A_ID,
      status: "OPEN",
    });

    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/apply`)
      .set(authHeader(CLIENT_A_ID))
      .send({
        jobId: JOB_ID,
        proposal: "I want to apply to my own job. This is a test proposal that is long enough to pass validation requirements.",
        estimatedDuration: 14,
        bidAmount: 500,
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "You cannot apply to your own job." });
    expect(applicationMock.findUnique).not.toHaveBeenCalled();
    expect(applicationMock.create).not.toHaveBeenCalled();
  });

  it("returns 404 when job does not exist", async () => {
    jobMock.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/apply`)
      .set(authHeader(CLIENT_A_ID))
      .send({
        jobId: JOB_ID,
        proposal: "Test proposal that is long enough to meet the minimum character requirement for validation.",
        estimatedDuration: 14,
        bidAmount: 500,
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Job not found." });
  });

  it("returns 400 when job is not open", async () => {
    jobMock.findUnique.mockResolvedValueOnce({
      id: JOB_ID,
      clientId: CLIENT_B_ID,
      status: "IN_PROGRESS",
    });

    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/apply`)
      .set(authHeader(CLIENT_A_ID))
      .send({
        jobId: JOB_ID,
        proposal: "Test proposal that is long enough to meet the minimum character requirement for validation.",
        estimatedDuration: 14,
        bidAmount: 500,
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Job is not accepting applications." });
  });
});

// ─── Wallet verification on POST /apply (#801) ────────────────────────────────
describe("POST /api/jobs/:jobId/apply — wallet verification (#801)", () => {
  const FREELANCER_ID = "00000000-0000-4000-8000-000000000300";
  const VALID_BODY = {
    jobId: JOB_ID,
    proposal:
      "I am highly experienced and would love to work on this project. This proposal meets the minimum length requirement.",
    estimatedDuration: 14,
    bidAmount: 500,
  };

  it("returns 422 WalletRequired when freelancer has no wallet connected", async () => {
    // auth middleware: role/emailVerified check
    userMock.findUnique.mockResolvedValueOnce({ role: "FREELANCER", emailVerified: true });
    // wallet check in route handler
    userMock.findUnique.mockResolvedValueOnce({ walletAddress: null });

    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/apply`)
      .set(authHeader(FREELANCER_ID))
      .send(VALID_BODY);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("WalletRequired");
    expect(res.body.message).toMatch(/wallet/i);
    expect(jobMock.findUnique).not.toHaveBeenCalled();
    expect(applicationMock.create).not.toHaveBeenCalled();
  });

  it("proceeds past wallet check when freelancer has a wallet connected", async () => {
    // auth middleware: role/emailVerified check
    userMock.findUnique.mockResolvedValueOnce({ role: "FREELANCER", emailVerified: true });
    // wallet check in route handler
    userMock.findUnique.mockResolvedValueOnce({
      walletAddress: "GDTEST000000000000000000000000000000000000000000000000000",
    });
    jobMock.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/apply`)
      .set(authHeader(FREELANCER_ID))
      .send(VALID_BODY);

    // Wallet check passed → proceeds to job lookup → 404 (job not found)
    expect(res.status).toBe(404);
    expect(res.body.code).toBeUndefined();
    expect(jobMock.findUnique).toHaveBeenCalled();
  });
});

// ─── DELETE /api/applications/:id ─────────────────────────────────────────────
describe("DELETE /api/applications/:id", () => {
  const APP_ID = "00000000-0000-4000-8000-000000000200";
  const FREELANCER_ID = "00000000-0000-4000-8000-000000000300";

  it("returns 401 with no auth token", async () => {
    const res = await request(app).delete(`/api/applications/${APP_ID}`);
    expect(res.status).toBe(401);
  });

  it("returns 404 when application does not exist", async () => {
    applicationMock.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .delete(`/api/applications/${APP_ID}`)
      .set(authHeader(FREELANCER_ID));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Application not found." });
  });

  it("returns 403 when caller is not the applicant", async () => {
    applicationMock.findUnique.mockResolvedValueOnce({
      id: APP_ID,
      freelancerId: FREELANCER_ID,
      status: "PENDING",
    });

    const res = await request(app)
      .delete(`/api/applications/${APP_ID}`)
      .set(authHeader(CLIENT_A_ID)); // different user

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Not authorized." });
  });

  it("freelancer can withdraw a pending application", async () => {
    applicationMock.findUnique.mockResolvedValueOnce({
      id: APP_ID,
      freelancerId: FREELANCER_ID,
      status: "PENDING",
    });
    applicationMock.delete.mockResolvedValueOnce({});

    const res = await request(app)
      .delete(`/api/applications/${APP_ID}`)
      .set(authHeader(FREELANCER_ID));

    expect(res.status).toBe(204);
    expect(applicationMock.delete).toHaveBeenCalledWith({ where: { id: APP_ID } });
  });

  it("returns 409 when freelancer tries to withdraw an accepted application", async () => {
    applicationMock.findUnique.mockResolvedValueOnce({
      id: APP_ID,
      freelancerId: FREELANCER_ID,
      status: "ACCEPTED",
    });

    const res = await request(app)
      .delete(`/api/applications/${APP_ID}`)
      .set(authHeader(FREELANCER_ID));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Cannot withdraw an accepted or rejected application." });
  });

  it("returns 409 when freelancer tries to withdraw a rejected application", async () => {
    applicationMock.findUnique.mockResolvedValueOnce({
      id: APP_ID,
      freelancerId: FREELANCER_ID,
      status: "REJECTED",
    });

    const res = await request(app)
      .delete(`/api/applications/${APP_ID}`)
      .set(authHeader(FREELANCER_ID));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Cannot withdraw an accepted or rejected application." });
  });
});



