const mockState = {
  cursor: "0",
  cursorUpdates: [] as string[],
  lastIndexedLedger: null as number | null,
  dlq: [] as Array<Record<string, any>>,
  jobFindFirstFailure: null as Error | null,
};

const mockGetEvents = jest.fn();
const mockGetLatestLedger = jest.fn();

const mockCursorUpsert = jest.fn(async ({ update, create }: any) => {
  const next = update.cursor ?? create.cursor;
  mockState.cursor = next;
  mockState.cursorUpdates.push(next);
  return { id: 1, cursor: mockState.cursor, updatedAt: new Date() };
});

const mockJobFindFirst = jest.fn(async () => {
  if (mockState.jobFindFirstFailure) throw mockState.jobFindFirstFailure;
  return null;
});

const mockPrisma = {
  horizonCursor: {
    upsert: mockCursorUpsert,
    findUnique: jest.fn(async () => ({ id: 1, cursor: mockState.cursor })),
  },
  syncState: {
    upsert: jest.fn(async ({ update }: any) => {
      mockState.lastIndexedLedger = update.lastIndexedLedger;
      return { id: "default", lastIndexedLedger: mockState.lastIndexedLedger };
    }),
  },
  horizonDlq: {
    create: jest.fn(async ({ data }: any) => {
      const entry = { id: mockState.dlq.length + 1, ...data, replayedAt: null };
      mockState.dlq.push(entry);
      return entry;
    }),
    count: jest.fn(async () => mockState.dlq.filter((entry) => !entry.replayedAt).length),
    findMany: jest.fn(async () => mockState.dlq),
    update: jest.fn(),
  },
  job: {
    findFirst: mockJobFindFirst,
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
  BadgeTier: {
    BRONZE: "BRONZE",
    SILVER: "SILVER",
    GOLD: "GOLD",
    PLATINUM: "PLATINUM",
  },
  EscrowEventType: {
    JOB_CREATED: "JOB_CREATED",
    JOB_FUNDED: "JOB_FUNDED",
    PAYMENT_RELEASED: "PAYMENT_RELEASED",
    DISPUTE_OPENED: "DISPUTE_OPENED",
    DISPUTE_RESOLVED: "DISPUTE_RESOLVED",
    REFUNDED: "REFUNDED",
    EXPIRED: "EXPIRED",
  },
  NotificationType: {
    PAYMENT_RELEASED: "PAYMENT_RELEASED",
    DISPUTE_RAISED: "DISPUTE_RAISED",
    DISPUTE_RESOLVED: "DISPUTE_RESOLVED",
    BADGE_AWARDED: "BADGE_AWARDED",
  },
}));

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn(() => ({
      getEvents: mockGetEvents,
      getLatestLedger: mockGetLatestLedger,
    })),
  },
  scValToNative: jest.fn((value: { native: unknown }) => value.native),
  xdr: {
    ScVal: {
      fromXDR: jest.fn(),
    },
  },
}));

jest.mock("../../config", () => ({
  config: {
    stellar: {
      rpcUrl: "https://rpc.test",
      escrowContractId: "escrow-contract",
      disputeContractId: "dispute-contract",
      reputationContractId: "reputation-contract",
    },
  },
}));

jest.mock("../notification.service", () => ({
  NotificationService: { deliverPersistedNotification: jest.fn() },
}));

jest.mock("../../lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function makeEvent(
  pagingToken: string,
  topic: unknown[] = ["unknown", "unknown"],
  value: unknown[] = [],
) {
  const scVal = (native: unknown) => ({
    native,
    toXDR: jest.fn(() => Buffer.from(JSON.stringify(native)).toString("base64")),
  });

  return {
    id: pagingToken,
    pagingToken,
    type: "contract",
    ledger: Number(pagingToken),
    ledgerClosedAt: "2026-06-19T12:00:00Z",
    contractId: "contract",
    txHash: `tx-${pagingToken}`,
    inSuccessfulContractCall: true,
    topic: topic.map(scVal),
    value: scVal(value),
  };
}

describe("durable Horizon listener", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.cursor = "0";
    mockState.cursorUpdates = [];
    mockState.lastIndexedLedger = null;
    mockState.dlq = [];
    mockState.jobFindFirstFailure = null;
  });

  it("resumes from the persisted cursor after a simulated restart without gaps or duplicates", async () => {
    // Simulate a listener that already completed its initial bootstrap poll in
    // an earlier process, persisting cursor "100" — this poll should paginate
    // forward from there rather than replaying from ledger zero.
    mockState.cursor = "100";
    mockGetLatestLedger.mockResolvedValue({ sequence: 1_000 });

    const events = Array.from({ length: 10 }, (_, index) => makeEvent(String(101 + index)));
    mockGetEvents.mockImplementation(async ({ pagination }: any) => {
      const offset = Number(pagination.cursor) - 100;
      return { events: events.slice(offset, offset + 5) };
    });

    let service = await import("../horizon-listener.service");
    await service.pollHorizonOnce();

    jest.resetModules();
    service = await import("../horizon-listener.service");
    await service.pollHorizonOnce();

    expect(mockGetEvents.mock.calls.map(([request]) => request.pagination.cursor)).toEqual([
      "100",
      "105",
    ]);
    expect(mockState.cursorUpdates).toEqual(["105", "110"]);
    expect(mockState.cursor).toBe("110");
    expect(mockState.lastIndexedLedger).toBe(110);
  });

  it("moves a three-time failure to the DLQ", async () => {
    mockState.jobFindFirstFailure = new Error("database read failed");
    const service = await import("../horizon-listener.service");

    await service.processHorizonEvent(
      makeEvent("42", ["escrow", "created"], [42]) as any,
    );

    expect(mockJobFindFirst).toHaveBeenCalledTimes(3);
    expect(mockState.dlq).toHaveLength(1);
    expect(mockState.dlq[0]).toEqual(
      expect.objectContaining({
        cursor: "42",
        error: "database read failed",
        attempt: 1,
      }),
    );
  }, 10_000);
});
