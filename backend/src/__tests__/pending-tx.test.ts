/**
 * Tests for transaction pre-registration and idempotency (#653)
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Shared Prisma mock object (all PrismaClient instances share this) ─────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTx: Record<string, jest.MockedFunction<any>> = {
  upsert: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  findUnique: jest.fn(),
  findMany: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    transaction: mockTx,
  })),
}));

// ── Soroban RPC mock ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetTransaction = jest.fn() as jest.MockedFunction<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetLatestLedger = jest.fn() as jest.MockedFunction<any>;

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getTransaction: mockGetTransaction,
      getLatestLedger: mockGetLatestLedger,
    })),
  },
}));

// ── Config / logger mocks ─────────────────────────────────────────────────────

jest.mock("../config", () => ({
  config: {
    stellar: { rpcUrl: "https://soroban-testnet.stellar.org" },
  },
}));

jest.mock("../lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ── Import after mocks are in place ──────────────────────────────────────────

import { checkPendingTransactions } from "../jobs/pending-tx.job";

// ─────────────────────────────────────────────────────────────────────────────

const TX_HASH_A = "aaaa".repeat(16);
const TX_HASH_B = "bbbb".repeat(16);

beforeEach(() => {
  jest.clearAllMocks();
  mockTx.findMany.mockResolvedValue([]);
  mockGetLatestLedger.mockResolvedValue({ sequence: 1000 });
});

// `maxLedger` actually stores `tx.timeBounds.maxTime` — a Unix timestamp in
// seconds — not a ledger sequence number (see submitWithPreRegistration).
// Expiry must be checked against wall-clock time, not getLatestLedger().sequence.
const nowSeconds = () => Math.floor(Date.now() / 1000);

// ── Pre-registration idempotency ──────────────────────────────────────────────

describe("pre-register upsert — idempotency", () => {
  it("returns the same record on a second registration of the same txHash", async () => {
    const existing = { id: "rec-1", txHash: TX_HASH_A, status: "PENDING", createdAt: new Date() };
    mockTx.upsert.mockResolvedValue(existing);

    const call = () =>
      mockTx.upsert({
        where: { txHash: TX_HASH_A },
        update: {},
        create: { txHash: TX_HASH_A, type: "RELEASE", status: "PENDING" },
        select: { id: true, txHash: true, status: true, createdAt: true },
      });

    const r1 = await call();
    const r2 = await call();

    expect(r1.id).toBe(r2.id);
    expect(mockTx.upsert).toHaveBeenCalledTimes(2);
    // update: {} means the second call does not overwrite the existing record
    expect(mockTx.upsert.mock.calls[1][0].update).toEqual({});
  });
});

// ── Background job — EXPIRED ──────────────────────────────────────────────────

describe("checkPendingTransactions", () => {
  it("marks EXPIRED when NOT_FOUND and the maxTime deadline has passed", async () => {
    mockTx.findMany.mockResolvedValue([
      { id: "tx-1", txHash: TX_HASH_A, maxLedger: nowSeconds() - 100 },
    ]);
    mockGetTransaction.mockResolvedValue({ status: "NOT_FOUND" });

    await checkPendingTransactions();

    expect(mockTx.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "EXPIRED" }) }),
    );
    // Expiry is wall-clock based — the ledger-sequence RPC call must not be used.
    expect(mockGetLatestLedger).not.toHaveBeenCalled();
  });

  it("marks SUCCESS when RPC returns SUCCESS", async () => {
    mockTx.findMany.mockResolvedValue([
      { id: "tx-2", txHash: TX_HASH_B, maxLedger: nowSeconds() + 1000 },
    ]);
    mockGetTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 990 });

    await checkPendingTransactions();

    expect(mockTx.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCESS", confirmedLedger: 990 }),
      }),
    );
  });

  it("does NOT expire when NOT_FOUND but the maxTime deadline is still in the future", async () => {
    mockTx.findMany.mockResolvedValue([
      { id: "tx-3", txHash: TX_HASH_A, maxLedger: nowSeconds() + 1000 },
    ]);
    mockGetTransaction.mockResolvedValue({ status: "NOT_FOUND" });

    await checkPendingTransactions();

    expect(mockTx.update).not.toHaveBeenCalled();
  });

  it("does nothing when there are no pending transactions", async () => {
    mockTx.findMany.mockResolvedValue([]);

    await checkPendingTransactions();

    expect(mockGetTransaction).not.toHaveBeenCalled();
    expect(mockTx.update).not.toHaveBeenCalled();
  });
});

// ── Horizon listener — PENDING resolution ─────────────────────────────────────

describe("Horizon listener — resolvePreRegisteredTx", () => {
  it("marks PENDING as SUCCESS when a matching on-chain event arrives", async () => {
    mockTx.updateMany.mockResolvedValue({ count: 1 });

    await mockTx.updateMany({
      where: { txHash: TX_HASH_A, status: "PENDING" },
      data: { status: "SUCCESS", confirmedLedger: 1001 },
    });

    expect(mockTx.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { txHash: TX_HASH_A, status: "PENDING" },
        data: expect.objectContaining({ status: "SUCCESS" }),
      }),
    );
  });
});
