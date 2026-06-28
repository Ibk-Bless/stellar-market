import jwt from "jsonwebtoken";
import { authenticate, AuthRequest } from "../auth";

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn(),
}));

jest.mock("@prisma/client", () => {
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  return {
    PrismaClient: jest.fn(() => mockPrisma),
    UserRole: {
      CLIENT: "CLIENT",
      FREELANCER: "FREELANCER",
      ADMIN: "ADMIN",
    },
  };
});

// Import mocked Prisma types and instance
import { PrismaClient, UserRole } from "@prisma/client";
const prismaMock = new PrismaClient() as any;

describe("authenticate middleware", () => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const res = { status } as any;
  const next = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sets req.userId and req.userRole for valid token", async () => {
    const req = {
      headers: { authorization: "Bearer valid.token" },
      path: "/dashboard",
    } as AuthRequest;

    (jwt.verify as jest.Mock).mockReturnValue({ userId: "user-123" });
    prismaMock.user.findUnique.mockResolvedValue({ role: UserRole.CLIENT, emailVerified: true });

    await authenticate(req, res, next);

    expect(req.userId).toBe("user-123");
    expect(req.userRole).toBe(UserRole.CLIENT);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("returns 401 when user cannot be found", async () => {
    const req = {
      headers: { authorization: "Bearer valid.token" },
    } as AuthRequest;

    (jwt.verify as jest.Mock).mockReturnValue({ userId: "missing-user" });
    prismaMock.user.findUnique.mockResolvedValue(null);

    await authenticate(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "User not found." });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for missing token", async () => {
    const req = {
      headers: {},
    } as AuthRequest;

    await authenticate(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      error: "Access denied. No token provided.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 with ACCOUNT_DELETED for a soft-deleted user", async () => {
    const req = {
      headers: { authorization: "Bearer valid.token" },
      path: "/dashboard",
    } as AuthRequest;

    (jwt.verify as jest.Mock).mockReturnValue({ userId: "deleted-user" });
    prismaMock.user.findUnique.mockResolvedValue({
      role: UserRole.CLIENT,
      emailVerified: true,
      deletedAt: new Date("2025-01-01"),
    });

    await authenticate(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      error: "Account deleted.",
      code: "ACCOUNT_DELETED",
    });
    expect(next).not.toHaveBeenCalled();
  });
});
