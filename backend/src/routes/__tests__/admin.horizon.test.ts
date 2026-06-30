import express from "express";
import request from "supertest";

const mockGetHorizonStatus = jest.fn();
const mockOverrideHorizonCursor = jest.fn();
const mockReplayHorizonDlq = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => ({})),
  UserRole: { ADMIN: "ADMIN" },
  DisputeStatus: { OPEN: "OPEN" },
}));

jest.mock("../../middleware/auth", () => ({
  requireAdmin: jest.fn((req: any, _res: any, next: any) => {
    req.userId = "admin-1";
    req.userRole = "ADMIN";
    next();
  }),
}));

jest.mock("../../services/horizon-listener.service", () => ({
  getHorizonStatus: mockGetHorizonStatus,
  overrideHorizonCursor: mockOverrideHorizonCursor,
  replayHorizonDlq: mockReplayHorizonDlq,
}));

jest.mock("../../services/notification.service", () => ({
  NotificationService: { sendNotification: jest.fn() },
}));

jest.mock("../../utils/auditLogger", () => ({
  logAdminAction: jest.fn(),
}));

import adminRoutes from "../admin";

const app = express();
app.use(express.json());
app.use("/admin", adminRoutes);

describe("admin Horizon endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns listener status", async () => {
    mockGetHorizonStatus.mockResolvedValue({
      cursor: "123",
      dlqDepth: 2,
      lastEventTimestamp: new Date("2026-06-19T12:00:00Z"),
    });

    const response = await request(app).get("/admin/horizon/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      cursor: "123",
      dlqDepth: 2,
      lastEventTimestamp: "2026-06-19T12:00:00.000Z",
    });
  });

  it("replays unresolved DLQ entries", async () => {
    mockReplayHorizonDlq.mockResolvedValue({ replayed: 3, failed: 1 });

    const response = await request(app).post("/admin/horizon/dlq/replay");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ replayed: 3, failed: 1 });
  });

  it("validates and persists a manual cursor override", async () => {
    const response = await request(app)
      .post("/admin/horizon/cursor")
      .send({ cursor: "456" });

    expect(response.status).toBe(200);
    expect(mockOverrideHorizonCursor).toHaveBeenCalledWith("456");

    const invalid = await request(app)
      .post("/admin/horizon/cursor")
      .send({ cursor: "" });
    expect(invalid.status).toBe(400);
  });
});
