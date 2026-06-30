import crypto from "crypto";

const mockRefreshToken = {
  updateMany: jest.fn(),
};
const mockUser = {
  findUnique: jest.fn(),
  update: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => ({
    refreshToken: mockRefreshToken,
    user: mockUser,
    $disconnect: jest.fn(),
  })),
  UserRole: {
    CLIENT: "CLIENT",
    FREELANCER: "FREELANCER",
    ADMIN: "ADMIN",
  },
}));

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn(),
}));

jest.mock("../../config", () => ({
  config: {
    jwtSecret: "test-secret",
    frontendUrl: "http://localhost:3000",
    stellar: {
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
      secondaryRpcUrl: "https://soroban-testnet.stellar.org/secondary",
      horizonUrl: "https://horizon-testnet.stellar.org",
      escrowContractId: "CCJFT7373737",
      disputeContractId: "CCJFT7373738",
      reputationContractId: "CCJFT7373739",
      nativeTokenId: "CDLZFC3SYJYDZT7K67VZ75YJBMKBAV27Z6Y6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z",
      keeperSecretKey: "",
    },
  },
}));

jest.mock("../../lib/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
  installRequestIdConsolePatch: jest.fn(),
}));

jest.mock("../../lib/cache", () => ({
  invalidateCacheKey: jest.fn(),
  generateUserCacheKey: jest.fn(),
  cache: jest.fn(),
}));

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import userRouter from "../user.routes";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/users", userRouter);
  return app;
}

describe("DELETE /users/me", () => {
  const app = buildApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 ACCOUNT_DELETED for a soft-deleted user", async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: "deleted-user" });
    mockUser.findUnique.mockResolvedValue({
      role: "CLIENT",
      emailVerified: true,
      deletedAt: new Date("2025-01-01"),
    });

    const res = await request(app)
      .get("/users/me")
      .set("Authorization", "Bearer old.token");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: "Account deleted.",
      code: "ACCOUNT_DELETED",
    });
  });

  it("allows requests from non-deleted users", async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: "active-user" });
    mockUser.findUnique.mockResolvedValue({
      id: "active-user",
      username: "alice",
      walletAddress: null,
      email: "alice@test.com",
      emailVerified: true,
      password: "hashed",
      bio: null,
      avatarUrl: null,
      role: "CLIENT",
      skills: [],
      availability: true,
      completedOnboarding: true,
      createdAt: new Date(),
      deletedAt: null,
    });

    const res = await request(app)
      .get("/users/me")
      .set("Authorization", "Bearer valid.token");

    expect(res.status).toBe(200);
  });

  it("soft-deletes the user and revokes refresh tokens", async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: "user-to-delete" });
    mockUser.findUnique.mockResolvedValue({
      role: "CLIENT",
      emailVerified: true,
      deletedAt: null,
    });
    mockUser.update.mockResolvedValue({ id: "user-to-delete", deletedAt: new Date() });
    mockRefreshToken.updateMany.mockResolvedValue({ count: 3 });

    const res = await request(app)
      .delete("/users/me")
      .set("Authorization", "Bearer valid.token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Account deleted." });
    expect(mockUser.update).toHaveBeenCalledWith({
      where: { id: "user-to-delete" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(mockRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-to-delete" },
      data: { revoked: true },
    });
  });
});
