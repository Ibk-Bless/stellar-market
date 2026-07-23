/**
 * Security tests for POST /api/escrow/confirm-tx (#871)
 *
 * Covers:
 *  - Spoofed hash from an unrelated contract → rejected
 *  - Valid fund_job hash for job A claimed against job B → rejected
 *  - Unauthorized caller (neither client nor freelancer) → rejected
 *  - Source account mismatch with caller's registered wallet → rejected
 *  - Function name mismatch (type vs actual on-chain call) → rejected
 *  - Happy path: FUND_JOB, SUBMIT_MILESTONE, APPROVE_MILESTONE, CREATE_JOB
 */

import express from "express";
import request from "supertest";

// ── Controllable userId for per-test auth simulation ──────────────────────────

let currentUserId = "CLIENT_ID_PLACEHOLDER";

jest.mock("../../middleware/auth", () => ({
  // Bypass real JWT validation; just inject the test-controlled userId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.userId = currentUserId;
    next();
  }),
  walletSourceGuard: jest.fn((_req: any, _res: any, next: any) => next()),
}));

// ── Contract service mock ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockVerifyTransactionEffects = jest.fn() as jest.MockedFunction<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSyncJobFromChain = jest.fn() as jest.MockedFunction<any>;

jest.mock("../../services/contract.service", () => ({
  ContractService: {
    verifyTransactionEffects: mockVerifyTransactionEffects,
    syncJobFromChain: mockSyncJobFromChain,
    buildCreateJobTx: jest.fn(),
    buildFundJobTx: jest.fn(),
    buildApproveMilestoneTx: jest.fn(),
    verifyTransaction: jest.fn(),
    simulateFundJob: jest.fn().mockResolvedValue({ ok: true }),
    getRateSnapshot: jest.fn(),
    getEscrowTtl: jest.fn(),
  },
  ContractSimulationError: class ContractSimulationError extends Error {},
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma: Record<string, any> = {
  job: { findUnique: jest.fn(), update: jest.fn() },
  milestone: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  user: { findUnique: jest.fn() },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction: jest.fn(async (cb: (tx: any) => Promise<void>) => {
    await cb({
      milestone: {
        update: jest.fn().mockResolvedValue({
          id: "ms1",
          jobId: JOB_A_ID,
          title: "MS",
          job: { clientId: CLIENT_ID, freelancerId: FREELANCER_ID },
        }),
        findMany: jest.fn().mockResolvedValue([{ status: "APPROVED" }]),
      },
      job: { update: jest.fn() },
    });
  }),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
  EscrowStatus: {
    UNFUNDED: "UNFUNDED",
    FUNDED: "FUNDED",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
  },
  NotificationType: {
    MILESTONE_APPROVED: "MILESTONE_APPROVED",
    MILESTONE_SUBMITTED: "MILESTONE_SUBMITTED",
  },
}));

jest.mock("../../services/notification.service", () => ({
  NotificationService: { sendNotification: jest.fn() },
}));

jest.mock("../../lib/cache", () => ({
  invalidateCache: jest.fn(),
  invalidateCacheKey: jest.fn(),
  generateJobCacheKey: (id: string) => `job:${id}`,
  generateJobOnChainStatusCacheKey: (id: string) => `job:onchain:${id}`,
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const CLIENT_ID     = "00000000-0000-4000-8000-000000000001";
const FREELANCER_ID = "00000000-0000-4000-8000-000000000002";
const OUTSIDER_ID   = "00000000-0000-4000-8000-000000000003";
const JOB_A_ID      = "00000000-0000-4000-8000-000000000100";
const JOB_B_ID      = "00000000-0000-4000-8000-000000000200";
const MILESTONE_ID  = "00000000-0000-4000-8000-000000000300";

const ESCROW_CONTRACT   = "CESCROWCONTRACT00000000000000000000000000000000000000000";
const OTHER_CONTRACT    = "COTHER000000000000000000000000000000000000000000000000";
const CLIENT_WALLET     = "GCLIENTWALLET000000000000000000000000000000000000000000";
const FREELANCER_WALLET = "GFREELANCERWALLET000000000000000000000000000000000000000";

// Override the configured escrow contract ID for tests
jest.mock("../../config", () => ({
  config: {
    jwtSecret: "test-secret",
    stellar: {
      escrowContractId: "CESCROWCONTRACT00000000000000000000000000000000000000000",
      rpcUrl: "https://soroban-testnet.stellar.org",
    },
  },
}));

// ── App setup ─────────────────────────────────────────────────────────────────

import escrowRouter from "../escrow.routes";

const app = express();
app.use(express.json());
app.use("/api/escrow", escrowRouter);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_A_ID,
    clientId: CLIENT_ID,
    freelancerId: FREELANCER_ID,
    contractJobId: "42",
    client: { walletAddress: CLIENT_WALLET },
    freelancer: { walletAddress: FREELANCER_WALLET },
    ...overrides,
  };
}

function makeMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: MILESTONE_ID,
    onChainIndex: 0,
    jobId: JOB_A_ID,
    title: "Milestone 1",
    job: makeJob(),
    ...overrides,
  };
}

function validEffects(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    contractId: ESCROW_CONTRACT,
    functionName: "fund_job",
    args: [BigInt(42), CLIENT_WALLET],
    sourceAccount: CLIENT_WALLET,
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  currentUserId = CLIENT_ID;
  // Default: caller has the client wallet registered
  mockPrisma.user.findUnique.mockResolvedValue({ walletAddress: CLIENT_WALLET });
});

// ── 1. Spoofed hash from an unrelated contract ────────────────────────────────

describe("spoofed hash from a non-escrow contract", () => {
  it("rejects with 403 when the transaction invoked a different contract", async () => {
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({ contractId: OTHER_CONTRACT }),
    );
    mockPrisma.job.findUnique.mockResolvedValue(makeJob());

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "aaa", type: "FUND_JOB", jobId: JOB_A_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unexpected contract/i);
  });

  it("rejects with 403 when contractId could not be decoded (undefined) — fail closed", async () => {
    // contractId extraction has its own try/catch; undefined must not be treated as 'skip check'
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({ contractId: undefined }),
    );
    mockPrisma.job.findUnique.mockResolvedValue(makeJob());

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "aaa2", type: "FUND_JOB", jobId: JOB_A_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unexpected contract/i);
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });
});

// ── 2. Valid hash for job A submitted against job B ───────────────────────────

describe("job ID mismatch — valid tx for job A claimed against job B", () => {
  it("rejects when on-chain job ID does not match the target job's contractJobId", async () => {
    // Transaction was for on-chain job 42 (job A), request claims jobId = job B
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({ args: [BigInt(42), CLIENT_WALLET] }),
    );
    // Job B has contractJobId "99"
    mockPrisma.job.findUnique.mockResolvedValue(makeJob({ id: JOB_B_ID, contractJobId: "99" }));

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "bbb", type: "FUND_JOB", jobId: JOB_B_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/job ID does not match/i);
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });
});

// ── 3. Unauthorized caller ────────────────────────────────────────────────────

describe("unauthorized caller — not client or freelancer", () => {
  it("rejects FUND_JOB when the caller is neither client nor freelancer", async () => {
    currentUserId = OUTSIDER_ID;
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({ sourceAccount: "GOUTSIDER" }),
    );
    mockPrisma.job.findUnique.mockResolvedValue(makeJob());
    mockPrisma.user.findUnique.mockResolvedValue({ walletAddress: "GOUTSIDER" });

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "ccc", type: "FUND_JOB", jobId: JOB_A_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the client/i);
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  it("rejects SUBMIT_MILESTONE when the client tries to confirm (only freelancer may)", async () => {
    // client is signed in, but SUBMIT_MILESTONE must come from the freelancer
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({
        functionName: "submit_milestone",
        args: [BigInt(42), 0, CLIENT_WALLET],
        sourceAccount: CLIENT_WALLET,
      }),
    );
    mockPrisma.milestone.findUnique.mockResolvedValue(makeMilestone());

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "ddd", type: "SUBMIT_MILESTONE", milestoneId: MILESTONE_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the freelancer/i);
  });

  it("rejects APPROVE_MILESTONE when the freelancer tries to confirm (only client may)", async () => {
    currentUserId = FREELANCER_ID;
    mockPrisma.user.findUnique.mockResolvedValue({ walletAddress: FREELANCER_WALLET });
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({
        functionName: "approve_milestone",
        args: [BigInt(42), 0],
        sourceAccount: FREELANCER_WALLET,
      }),
    );
    mockPrisma.milestone.findUnique.mockResolvedValue(makeMilestone());

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "eee", type: "APPROVE_MILESTONE", milestoneId: MILESTONE_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the client/i);
  });
});

// ── 4. Source account mismatch ────────────────────────────────────────────────

describe("source account does not match caller's registered wallet", () => {
  it("rejects when the on-chain signer differs from the authenticated user's wallet", async () => {
    // Client's registered wallet is CLIENT_WALLET, but the tx was signed by FREELANCER_WALLET
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({ sourceAccount: FREELANCER_WALLET }),
    );
    mockPrisma.job.findUnique.mockResolvedValue(makeJob());
    // user.findUnique returns CLIENT_WALLET — mismatch with sourceAccount
    mockPrisma.user.findUnique.mockResolvedValue({ walletAddress: CLIENT_WALLET });

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "fff", type: "FUND_JOB", jobId: JOB_A_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/source account does not match/i);
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  it("rejects when sourceAccount could not be decoded (undefined) — fail closed", async () => {
    // sourceAccount extraction has its own try/catch; undefined must not skip the wallet check
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({ sourceAccount: undefined }),
    );
    mockPrisma.job.findUnique.mockResolvedValue(makeJob());
    mockPrisma.user.findUnique.mockResolvedValue({ walletAddress: CLIENT_WALLET });

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "fff2", type: "FUND_JOB", jobId: JOB_A_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/source account does not match/i);
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });
});

// ── 5. Function name mismatch ─────────────────────────────────────────────────

describe("function name mismatch — wrong on-chain call for declared type", () => {
  it("rejects FUND_JOB type when the tx called a different function", async () => {
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({ functionName: "transfer" }),
    );
    mockPrisma.job.findUnique.mockResolvedValue(makeJob());

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "ggg", type: "FUND_JOB", jobId: JOB_A_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/fund_job/i);
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  it("rejects CANCEL_JOB type when the tx actually called fund_job", async () => {
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({ functionName: "fund_job" }),
    );
    mockPrisma.job.findUnique.mockResolvedValue(makeJob());

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "hhh", type: "CANCEL_JOB", jobId: JOB_A_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cancel_job/i);
  });
});

// ── 6. On-chain verification failure ─────────────────────────────────────────

describe("on-chain verification failure", () => {
  it("returns 400 when the transaction is not found on-chain", async () => {
    mockVerifyTransactionEffects.mockResolvedValue({ success: false, error: "NOT_FOUND" });

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "zzz", type: "FUND_JOB", jobId: JOB_A_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/NOT_FOUND/);
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });
});

// ── 7. Happy paths ────────────────────────────────────────────────────────────

describe("happy path — authorized, matching transaction", () => {
  it("FUND_JOB: marks job FUNDED when all checks pass", async () => {
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({ functionName: "fund_job", args: [BigInt(42), CLIENT_WALLET] }),
    );
    mockPrisma.job.findUnique.mockResolvedValue(makeJob());
    mockPrisma.job.update.mockResolvedValue({});

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "ok1", type: "FUND_JOB", jobId: JOB_A_ID });

    expect(res.status).toBe(200);
    expect(mockPrisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ escrowStatus: "FUNDED" }) }),
    );
  });

  it("SUBMIT_MILESTONE: marks milestone SUBMITTED when freelancer confirms", async () => {
    currentUserId = FREELANCER_ID;
    mockPrisma.user.findUnique.mockResolvedValue({ walletAddress: FREELANCER_WALLET });
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({
        functionName: "submit_milestone",
        args: [BigInt(42), 0, FREELANCER_WALLET],
        sourceAccount: FREELANCER_WALLET,
      }),
    );
    mockPrisma.milestone.findUnique.mockResolvedValue(makeMilestone());

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "ok2", type: "SUBMIT_MILESTONE", milestoneId: MILESTONE_ID });

    expect(res.status).toBe(200);
  });

  it("APPROVE_MILESTONE: marks milestone APPROVED when client confirms", async () => {
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({
        functionName: "approve_milestone",
        args: [BigInt(42), 0],
        sourceAccount: CLIENT_WALLET,
      }),
    );
    mockPrisma.milestone.findUnique.mockResolvedValue(makeMilestone());
    mockPrisma.user.findUnique.mockResolvedValue({ walletAddress: CLIENT_WALLET });

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "ok3", type: "APPROVE_MILESTONE", milestoneId: MILESTONE_ID });

    expect(res.status).toBe(200);
  });

  it("CREATE_JOB: sets contractJobId and milestone on-chain indices when client confirms", async () => {
    mockVerifyTransactionEffects.mockResolvedValue(
      validEffects({
        functionName: "create_job",
        args: [CLIENT_WALLET, FREELANCER_WALLET, "CTOKEN", [], BigInt(9999)],
        sourceAccount: CLIENT_WALLET,
      }),
    );
    mockPrisma.job.findUnique.mockResolvedValue(makeJob());
    mockPrisma.job.update.mockResolvedValue({});
    mockPrisma.milestone.findMany.mockResolvedValue([
      { id: "ms-a", order: 0 },
      { id: "ms-b", order: 1 },
    ]);
    mockPrisma.milestone.update.mockResolvedValue({});

    const res = await request(app)
      .post("/api/escrow/confirm-tx")
      .send({ hash: "ok4", type: "CREATE_JOB", jobId: JOB_A_ID, onChainJobId: "42" });

    expect(res.status).toBe(200);
    expect(mockPrisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contractJobId: "42" }) }),
    );
    expect(mockPrisma.milestone.update).toHaveBeenCalledTimes(2);
  });
});
