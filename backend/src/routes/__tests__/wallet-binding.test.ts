/**
 * Unit tests for the wallet challenge / verify endpoints.
 *
 * Acceptance criteria verified here:
 *  - A user cannot bind a wallet address without proving key ownership
 *  - Replaying a used (or missing) challenge nonce returns CHALLENGE_EXPIRED
 *  - A valid signature from the wrong address returns INVALID_SIGNATURE
 *  - A tampered signature (one byte flipped) returns 401
 *  - JWT issued after verification includes walletAddress claim
 */

import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { Keypair } from "@stellar/stellar-sdk";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("otplib", () => ({
  generateSecret: jest.fn(),
  verifySync: jest.fn(),
  generateURI: jest.fn(),
}));

jest.mock("qrcode", () => ({
  toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,mock"),
}));

jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("hashed"),
  compare: jest.fn(),
}));

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn().mockReturnValue("new_access_token"),
  verify: jest.fn(),
}));

jest.mock("../../utils/email", () => ({
  sendPasswordResetEmail: jest.fn(),
  sendVerificationEmail: jest.fn(),
}));

jest.mock("../../utils/encryption", () => ({
  encrypt: jest.fn((t: string) => `enc:${t}`),
  decrypt: jest.fn((t: string) => t.replace("enc:", "")),
}));

jest.mock("../../utils/token", () => ({
  generateToken: jest.fn().mockReturnValue("raw_refresh_token"),
  hashToken: jest.fn().mockReturnValue("hashed_refresh_token"),
}));

// Prisma mock
const mockUser = {
  id: "user-123",
  walletAddress: null as string | null,
  username: "testuser",
  email: "test@example.com",
  role: "FREELANCER" as const,
  emailVerified: true,
  password: null,
  isSuspended: false,
};

const mockPrismaDb = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrismaDb),
  UserRole: { ADMIN: "ADMIN", CLIENT: "CLIENT", FREELANCER: "FREELANCER" },
}));

// Redis mock
let challengeNonce: string | null = null;

const mockRedis = {
  // The auth middleware's token-version cache (issue #787) shares this same
  // Redis client. Serve it a fixed cached version so it never falls through
  // to a Prisma lookup, which would otherwise consume the calls the tests
  // below queue up for the wallet-binding logic itself.
  get: jest.fn((key: string) =>
    Promise.resolve(key.startsWith("auth:tokenVersion:") ? "0" : challengeNonce),
  ),
  set: jest.fn().mockResolvedValue("OK"),
  del: jest.fn().mockResolvedValue(1),
};

jest.mock("../../lib/redis", () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(() => mockRedis),
    isRedisConnected: jest.fn(() => true),
    connect: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../config", () => ({
  config: { jwtSecret: "test_secret" },
}));

// ── App setup ────────────────────────────────────────────────────────────────

import authRoutes from "../auth.routes";

const app = express();
app.use(express.json());
app.use("/auth", authRoutes);

const USER_ID = "user-123";

function makeAuthHeader(userId = USER_ID) {
  // jwt.verify is mocked to return decoded when called; jwt.sign returns the
  // mock token.  For the authenticate middleware we make jwt.verify resolve
  // the payload for valid tokens.
  (jwt.verify as jest.Mock).mockReturnValue({
    userId,
    purpose: undefined,
  });
  return { Authorization: `Bearer valid_token` };
}

afterEach(() => jest.clearAllMocks());

// ── POST /auth/wallet/challenge ───────────────────────────────────────────────

describe("POST /auth/wallet/challenge", () => {
  beforeEach(() => {
    // authenticate middleware: user lookup
    mockPrismaDb.user.findUnique.mockResolvedValue({
      ...mockUser,
      role: "FREELANCER",
      emailVerified: true,
    });
  });

  it("returns a challenge string and expires_at when authenticated", async () => {
    const res = await request(app)
      .post("/auth/wallet/challenge")
      .set(makeAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("challenge");
    expect(res.body.challenge).toMatch(/^stellar-market:bind:user-123:/);
    expect(res.body).toHaveProperty("expires_at");
    expect(mockRedis.set).toHaveBeenCalledWith(
      "wallet_challenge:user-123",
      res.body.challenge,
      "EX",
      300,
    );
  });

  it("returns 401 without a token", async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error("invalid");
    });
    const res = await request(app).post("/auth/wallet/challenge");
    expect(res.status).toBe(401);
  });
});

// ── POST /auth/wallet/verify ──────────────────────────────────────────────────

describe("POST /auth/wallet/verify", () => {
  // Generate a deterministic test keypair
  const keypair = Keypair.random();
  const address = keypair.publicKey();

  function signChallenge(challenge: string) {
    return keypair
      .sign(Buffer.from(challenge, "utf8"))
      .toString("base64");
  }

  const challenge = `stellar-market:bind:${USER_ID}:deadbeef`;

  beforeEach(() => {
    mockPrismaDb.user.findUnique.mockResolvedValue({
      ...mockUser,
      role: "FREELANCER",
      emailVerified: true,
    });
  });

  it("binds the wallet and returns a token when signature is valid", async () => {
    challengeNonce = challenge;
    mockPrismaDb.user.findUnique
      .mockResolvedValueOnce({ ...mockUser, role: "FREELANCER", emailVerified: true }) // auth check
      .mockResolvedValueOnce(null); // no existing owner
    mockPrismaDb.user.update.mockResolvedValue({
      ...mockUser,
      walletAddress: address,
    });

    const sig = signChallenge(challenge);
    const res = await request(app)
      .post("/auth/wallet/verify")
      .set(makeAuthHeader())
      .send({ address, signature: sig });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user.walletAddress).toBe(address);
    expect(mockRedis.del).toHaveBeenCalledWith("wallet_challenge:user-123");
    // JWT must be signed with walletAddress claim
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, walletAddress: address }),
      "test_secret",
      expect.any(Object),
    );
  });

  it("returns CHALLENGE_EXPIRED when no nonce is in Redis", async () => {
    challengeNonce = null;

    const sig = signChallenge(challenge);
    const res = await request(app)
      .post("/auth/wallet/verify")
      .set(makeAuthHeader())
      .send({ address, signature: sig });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("CHALLENGE_EXPIRED");
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it("returns INVALID_SIGNATURE for a valid address but wrong signature", async () => {
    challengeNonce = challenge;

    const wrongKeypair = Keypair.random();
    const wrongSig = wrongKeypair
      .sign(Buffer.from(challenge, "utf8"))
      .toString("base64");

    const res = await request(app)
      .post("/auth/wallet/verify")
      .set(makeAuthHeader())
      .send({ address, signature: wrongSig });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_SIGNATURE");
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it("returns INVALID_SIGNATURE when one byte of the signature is flipped", async () => {
    challengeNonce = challenge;

    const sigBytes = keypair.sign(Buffer.from(challenge, "utf8"));
    // Flip the first byte
    sigBytes[0] ^= 0xff;
    const tamperedSig = sigBytes.toString("base64");

    const res = await request(app)
      .post("/auth/wallet/verify")
      .set(makeAuthHeader())
      .send({ address, signature: tamperedSig });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_SIGNATURE");
  });

  it("returns 409 when the address is already owned by another account", async () => {
    challengeNonce = challenge;
    mockPrismaDb.user.findUnique
      .mockResolvedValueOnce({ ...mockUser, role: "FREELANCER", emailVerified: true }) // auth
      .mockResolvedValueOnce({ id: "other-user", walletAddress: address }); // existing owner

    const sig = signChallenge(challenge);
    const res = await request(app)
      .post("/auth/wallet/verify")
      .set(makeAuthHeader())
      .send({ address, signature: sig });

    expect(res.status).toBe(409);
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it("returns 400 when address field is missing", async () => {
    challengeNonce = challenge;

    const sig = signChallenge(challenge);
    const res = await request(app)
      .post("/auth/wallet/verify")
      .set(makeAuthHeader())
      .send({ signature: sig });

    expect(res.status).toBe(400);
  });
});
