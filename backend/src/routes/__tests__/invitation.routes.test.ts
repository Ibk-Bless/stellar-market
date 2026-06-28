import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config";
import invitationRouter from "../invitation.routes";

// ─── Prisma & NotificationService mocks ───────────────────────────────────────
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    job: { findUnique: jest.fn() },
    invitation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };

  return {
    PrismaClient: jest.fn(() => mockPrisma) as any,
    NotificationType: { JOB_INVITATION: "JOB_INVITATION" } as any,
  };
});

jest.mock("../../services/notification.service", () => ({
  NotificationService: {
    sendNotification: jest.fn().mockResolvedValue({ id: "mock-notif-id" }),
  },
}));

import { PrismaClient } from "@prisma/client";
import { NotificationService } from "../../services/notification.service";
const prismaMock = new PrismaClient() as any;
const jobMock = prismaMock.job;
const invitationMock = prismaMock.invitation;
const userMock = prismaMock.user;

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use("/api", invitationRouter);

const JOB_ID = "00000000-0000-4000-8000-000000000100";
const CLIENT_A_ID = "00000000-0000-4000-8000-000000000001";
const CLIENT_B_ID = "00000000-0000-4000-8000-000000000002";
const FREELANCER_ID = "00000000-0000-4000-8000-000000000300";

function authHeader(userId = CLIENT_A_ID) {
  const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

// Route user.findUnique by the fields each caller selects so the auth
// middleware, freelancer lookup and inviter lookup each get the right shape.
function setupUserLookups() {
  userMock.findUnique.mockImplementation(({ where, select }: any) => {
    if (select?.emailVerified) {
      // auth middleware
      return Promise.resolve({ role: "CLIENT", emailVerified: true });
    }
    if (select?.role && select?.username) {
      // freelancer lookup
      return Promise.resolve({
        id: where.id,
        role: where.id === FREELANCER_ID ? "FREELANCER" : "CLIENT",
        username: "freelancer",
      });
    }
    // inviter username lookup
    return Promise.resolve({ username: "clientuser" });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupUserLookups();
});

describe("POST /api/jobs/:jobId/invitations", () => {
  it("returns 401 with no auth token", async () => {
    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/invitations`)
      .send({ freelancerId: FREELANCER_ID });
    expect(res.status).toBe(401);
  });

  it("returns 404 when job does not exist", async () => {
    jobMock.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/invitations`)
      .set(authHeader())
      .send({ freelancerId: FREELANCER_ID });

    expect(res.status).toBe(404);
    expect(invitationMock.create).not.toHaveBeenCalled();
  });

  it("returns 403 when the requester is not the job owner", async () => {
    jobMock.findUnique.mockResolvedValueOnce({
      id: JOB_ID,
      clientId: CLIENT_B_ID,
      title: "Build a dApp",
      status: "OPEN",
    });

    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/invitations`)
      .set(authHeader(CLIENT_A_ID))
      .send({ freelancerId: FREELANCER_ID });

    expect(res.status).toBe(403);
    expect(invitationMock.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the invitee is not a freelancer", async () => {
    jobMock.findUnique.mockResolvedValueOnce({
      id: JOB_ID,
      clientId: CLIENT_A_ID,
      title: "Build a dApp",
      status: "OPEN",
    });

    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/invitations`)
      .set(authHeader(CLIENT_A_ID))
      .send({ freelancerId: CLIENT_B_ID }); // not the FREELANCER_ID → role CLIENT

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Invitations can only be sent to freelancers.",
    });
    expect(invitationMock.create).not.toHaveBeenCalled();
  });

  it("returns 409 when the freelancer was already invited", async () => {
    jobMock.findUnique.mockResolvedValueOnce({
      id: JOB_ID,
      clientId: CLIENT_A_ID,
      title: "Build a dApp",
      status: "OPEN",
    });
    invitationMock.findUnique.mockResolvedValueOnce({ id: "existing" });

    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/invitations`)
      .set(authHeader(CLIENT_A_ID))
      .send({ freelancerId: FREELANCER_ID });

    expect(res.status).toBe(409);
    expect(invitationMock.create).not.toHaveBeenCalled();
  });

  it("creates an invitation and notifies the freelancer", async () => {
    jobMock.findUnique.mockResolvedValueOnce({
      id: JOB_ID,
      clientId: CLIENT_A_ID,
      title: "Build a dApp",
      status: "OPEN",
    });
    invitationMock.findUnique.mockResolvedValueOnce(null);
    invitationMock.create.mockResolvedValueOnce({
      id: "inv-1",
      jobId: JOB_ID,
      freelancerId: FREELANCER_ID,
      clientId: CLIENT_A_ID,
      status: "PENDING",
    });

    const res = await request(app)
      .post(`/api/jobs/${JOB_ID}/invitations`)
      .set(authHeader(CLIENT_A_ID))
      .send({ freelancerId: FREELANCER_ID, message: "Would love to work with you" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "inv-1", freelancerId: FREELANCER_ID });
    expect(invitationMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: JOB_ID,
          freelancerId: FREELANCER_ID,
          clientId: CLIENT_A_ID,
          message: "Would love to work with you",
        }),
      }),
    );
    expect(NotificationService.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: FREELANCER_ID,
        type: "JOB_INVITATION",
        metadata: expect.objectContaining({ jobId: JOB_ID, invitationId: "inv-1" }),
      }),
    );
  });
});

describe("GET /api/jobs/:jobId/invitations", () => {
  it("returns 403 when the requester is not the job owner", async () => {
    jobMock.findUnique.mockResolvedValueOnce({ clientId: CLIENT_B_ID });

    const res = await request(app)
      .get(`/api/jobs/${JOB_ID}/invitations`)
      .set(authHeader(CLIENT_A_ID));

    expect(res.status).toBe(403);
    expect(invitationMock.findMany).not.toHaveBeenCalled();
  });

  it("returns the invitation list for the job owner", async () => {
    jobMock.findUnique.mockResolvedValueOnce({ clientId: CLIENT_A_ID });
    invitationMock.findMany.mockResolvedValueOnce([
      {
        id: "inv-1",
        jobId: JOB_ID,
        freelancerId: FREELANCER_ID,
        status: "PENDING",
        freelancer: { id: FREELANCER_ID, username: "freelancer", avatarUrl: null },
      },
    ]);

    const res = await request(app)
      .get(`/api/jobs/${JOB_ID}/invitations`)
      .set(authHeader(CLIENT_A_ID));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1 });
    expect(res.body.data).toHaveLength(1);
  });
});
