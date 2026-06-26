import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { Buffer } from "buffer";
import { PrismaClient } from "@prisma/client";
import { config } from "../../config";
import uploadRouter from "../upload.routes";
import { UPLOAD_DIR } from "../../config/upload";

jest.mock("@prisma/client", () => {
  const mockPrisma = {
    job: { findUnique: jest.fn().mockResolvedValue({ id: "job-123", clientId: "00000000-0000-4000-8000-000000000001", freelancerId: "2" }) },
    attachment: {
      create: jest.fn().mockResolvedValue({ id: "123", size: 1024 }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ role: "CLIENT", emailVerified: true }),
    },
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

jest.mock("../../utils/virusScanner", () => ({
  scanFile: jest.fn().mockResolvedValue({ isInfected: false, skipped: true }),
}));

jest.mock("../../utils/auditLogger", () => ({
  auditLogger: { log: jest.fn() },
}));

const app = express();
app.use(express.json());
// Stub authenticate middleware req setup if needed, but the router uses `req.userId!`
app.use("/api/uploads", uploadRouter);

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
function authHeader(userId = CLIENT_ID) {
  const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

describe("POST /api/uploads Signature Checks", () => {
  const testDir = path.join(__dirname, "test_files");

  beforeAll(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("should reject an ELF file masquerading as JPEG with 415", async () => {
    const maliciousPath = path.join(testDir, "malicious.jpg");
    // ELF Magic bytes: 7F 45 4C 46
    const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
    fs.writeFileSync(maliciousPath, elfBuffer);

    const res = await request(app)
      .post("/api/uploads")
      .set(authHeader())
      .field("jobId", "job-123")
      .attach("file", maliciousPath, { contentType: "image/jpeg" });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/signature/i);
  });

  it("should accept a genuine JPEG file", async () => {
    const validJpegPath = path.join(testDir, "valid.jpg");
    // Magic bytes for JPEG: FF D8 FF
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    fs.writeFileSync(validJpegPath, jpegBuffer);

    const res = await request(app)
      .post("/api/uploads")
      .set(authHeader())
      .field("jobId", "job-123")
      .attach("file", validJpegPath, { contentType: "image/jpeg" });

    expect(res.status).toBe(201);
  });
});
