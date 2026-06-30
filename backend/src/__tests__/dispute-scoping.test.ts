/**
 * Tests for #803: GET /disputes must be scoped to the requesting user.
 */
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

// ── Prisma mock ──────────────────────────────────────────────────────────────
jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => ({
    dispute: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    attachment: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    $use: jest.fn(),
  })),
  DisputeStatus: { OPEN: "OPEN", RESOLVED: "RESOLVED" },
  UserRole: { FREELANCER: "FREELANCER", CLIENT: "CLIENT", ADMIN: "ADMIN" },
}));

// ── DisputeService mock ──────────────────────────────────────────────────────
const mockGetDisputes = jest.fn().mockResolvedValue({ disputes: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });

jest.mock("../services/dispute.service", () => ({
  DisputeService: { getDisputes: mockGetDisputes },
}));

// ── Validation mock (pass-through) ──────────────────────────────────────────
jest.mock("../middleware/validation", () => ({
  validate: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── asyncHandler mock (pass-through) ────────────────────────────────────────
jest.mock("../middleware/error", () => ({
  asyncHandler: (fn: Function) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next),
  errorHandler: (_err: unknown, _req: Request, res: Response, _next: NextFunction) =>
    res.status(500).json({ error: "internal" }),
}));

// ── Configurable auth mock ───────────────────────────────────────────────────
let mockUserId = "user-1";
let mockUserRole = "FREELANCER";

jest.mock("../middleware/auth", () => ({
  authenticate: (req: any, _res: Response, next: NextFunction) => {
    req.userId = mockUserId;
    req.userRole = mockUserRole;
    next();
  },
  AuthRequest: {},
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── Other mocks needed by the route file ────────────────────────────────────
jest.mock("../config/upload", () => ({ upload: { array: () => (_: any, __: any, next: any) => next() }, UPLOAD_DIR: "/tmp" }));
jest.mock("../services/evidence-storage.service", () => ({
  createEvidenceDownloadUrl: jest.fn(),
  isEvidenceStorageConfigured: jest.fn().mockReturnValue(false),
  readEvidenceObject: jest.fn(),
  uploadEvidenceObject: jest.fn(),
}));
jest.mock("../config", () => ({
  config: { stellar: { horizonUrl: "https://horizon.stellar.org" }, evidenceStorage: { bucket: "test" } },
  MAX_PAGE_SIZE: 100,
}));
jest.mock("../schemas/dispute", () => ({
  createDisputeSchema: {},
  castVoteSchema: {},
  disputeIdParamSchema: {},
  initRaiseDisputeSchema: {},
  queryDisputesSchema: {},
  resolveDisputeSchema: {},
  webhookPayloadSchema: {},
  confirmDisputeTransactionSchema: {},
}));
jest.mock("../utils/fileValidation", () => ({
  validateFileMimeType: jest.fn(),
  formatFileSize: jest.fn().mockReturnValue("0 B"),
}));
jest.mock("../lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import disputeRouter from "../routes/dispute.routes";

const app = express();
app.use(express.json());
app.use("/api/disputes", disputeRouter);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDisputes.mockResolvedValue({
    disputes: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
});

describe("GET /api/disputes — user scoping (#803)", () => {
  it("freelancer only sees their own disputes (userFilter by freelancerId)", async () => {
    mockUserId = "freelancer-1";
    mockUserRole = "FREELANCER";

    await request(app).get("/api/disputes");

    expect(mockGetDisputes).toHaveBeenCalledWith(
      expect.objectContaining({ userFilter: { freelancerId: "freelancer-1" } }),
      expect.any(Object),
    );
  });

  it("client only sees their own disputes (userFilter by clientId)", async () => {
    mockUserId = "client-1";
    mockUserRole = "CLIENT";

    await request(app).get("/api/disputes");

    expect(mockGetDisputes).toHaveBeenCalledWith(
      expect.objectContaining({ userFilter: { clientId: "client-1" } }),
      expect.any(Object),
    );
  });

  it("admin sees all disputes (no userFilter applied)", async () => {
    mockUserId = "admin-1";
    mockUserRole = "ADMIN";

    await request(app).get("/api/disputes");

    expect(mockGetDisputes).toHaveBeenCalledWith(
      expect.objectContaining({ userFilter: undefined }),
      expect.any(Object),
    );
  });

  it("user with no disputes receives an empty array", async () => {
    mockUserId = "freelancer-empty";
    mockUserRole = "FREELANCER";
    mockGetDisputes.mockResolvedValue({
      disputes: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const res = await request(app).get("/api/disputes");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 403 for unrecognised roles", async () => {
    mockUserId = "unknown-1";
    mockUserRole = "UNKNOWN_ROLE";

    const res = await request(app).get("/api/disputes");

    expect(res.status).toBe(403);
    expect(mockGetDisputes).not.toHaveBeenCalled();
  });
});
