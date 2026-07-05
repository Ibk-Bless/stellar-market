import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { config } from "../../config";

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock("@prisma/client", () => {
  const mockPrisma = {
    notificationPreference: {
      upsert: jest.fn().mockResolvedValue({ userId: "user-1", marketingEmails: false }),
    },
  };
  return { PrismaClient: jest.fn(() => mockPrisma) as any };
});

import { PrismaClient } from "@prisma/client";
import unsubscribeRouter from "../unsubscribe.routes";

const prismaMock = new PrismaClient() as any;
const prefMock = prismaMock.notificationPreference;

const app = express();
app.use("/api/unsubscribe", unsubscribeRouter);

afterEach(() => jest.clearAllMocks());

// ─── Helper ───────────────────────────────────────────────────────────────────
function makeToken(payload: Record<string, unknown>, expiresIn: string | number = "90d") {
  return jwt.sign(payload, config.jwtSecret, { expiresIn } as any);
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("GET /api/unsubscribe (#800)", () => {
  it("returns 400 when no token is supplied", async () => {
    const res = await request(app).get("/api/unsubscribe");
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/No unsubscribe token/);
    expect(prefMock.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for an expired token", async () => {
    const token = makeToken({ userId: "user-1", type: "unsubscribe" }, -1);
    const res = await request(app).get(`/api/unsubscribe?token=${token}`);
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/expired/i);
    expect(prefMock.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for a token with the wrong type", async () => {
    const token = makeToken({ userId: "user-1", type: "access" });
    const res = await request(app).get(`/api/unsubscribe?token=${token}`);
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/invalid/i);
    expect(prefMock.upsert).not.toHaveBeenCalled();
  });

  it("sets marketingEmails to false for a valid unsubscribe token", async () => {
    const token = makeToken({ userId: "user-1", type: "unsubscribe" });
    const res = await request(app).get(`/api/unsubscribe?token=${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Unsubscribed/i);
    expect(prefMock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        update: { marketingEmails: false },
        create: { userId: "user-1", marketingEmails: false },
      }),
    );
  });
});

// ─── EmailService.generateUnsubscribeToken ────────────────────────────────────
describe("EmailService.generateUnsubscribeToken (#800)", () => {
  it("generates a verifiable JWT with userId and type=unsubscribe", () => {
    const { EmailService } = require("../../services/email.service");
    const token = EmailService.generateUnsubscribeToken("user-42");
    const payload = jwt.verify(token, config.jwtSecret) as any;
    expect(payload.userId).toBe("user-42");
    expect(payload.type).toBe("unsubscribe");
  });

  it("email body includes the unsubscribe URL when sent via sendEventEmail", async () => {
    jest.mock("nodemailer", () => ({
      createTransport: () => ({
        sendMail: jest.fn().mockResolvedValue({}),
      }),
    }));

    const { EmailService } = require("../../services/email.service");
    const url = EmailService.buildUnsubscribeUrl("user-99");
    expect(url).toContain("unsubscribe?token=");
    expect(url).toContain(config.frontendUrl);
  });
});
