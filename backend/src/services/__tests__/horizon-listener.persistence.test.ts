const mockState = {
  cursor: "0",
  cursorUpdates: [] as string[],
  dlq: [] as Array<Record<string, any>>,
  jobFailure: null as Error | null,
};

const mockGetEvents = jest.fn();
const mockJobUpdateMany = jest.fn(async () => {
  if (mockState.jobFailure) throw mockState.jobFailure;
  return { count: 0 };
});

const mockCursorUpsert = jest.fn(async ({ update, create }: any) => {
  const next = update.cursor ?? mockState.cursor ?? create.cursor;
  mockState.cursor = next;
  if (update.cursor) mockState.cursorUpdates.push(next);
  return {
    id: 1,
    cursor: mockState.cursor,
    updatedAt: new Date(),
    lastEventAt: update.lastEventAt ?? create.lastEventAt ?? null,
  };
});

const mockTx = {
  horizonCursor: { upsert: mockCursorUpsert },
  horizonDlq: {
    create: jest.fn(async ({ data }: any) => {
      const entry = { id: mockState.dlq.length + 1, ...data, replayedAt: null };
      mockState.dlq.push(entry);
      return entry;
    }),
    update: jest.fn(),
  },
  job: {
    updateMany: mockJobUpdateMany,
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  dispute: {
    findUnique: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  badge: { upsert: jest.fn() },
  notification: { create: jest.fn() },
};

const mockPrisma = {
  horizonCursor: { upsert: mockCursorUpsert },
  horizonDlq: {
    count: jest.fn(async () => mockState.dlq.filter((entry) => !entry.replayedAt).length),
    findMany: jest.fn(async () => mockState.dlq),
    update: jest.fn(),
  },
  $transaction: jest.fn(async (callback: (tx: typeof mockTx) => unknown) =>
    callback(mockTx),
  ),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
  BadgeTier: {
    BRONZE: "BRONZE",
    SILVER: "SILVER",
    GOLD: "GOLD",
    PLATINUM: "PLATINUM",
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
    mockState.dlq = [];
    mockState.jobFailure = null;
  });

  it("resumes from the persisted cursor after a simulated restart without gaps or duplicates", async () => {
    const events = Array.from({ length: 10 }, (_, index) => makeEvent(String(index + 1)));
    mockGetEvents.mockImplementation(async ({ pagination }: any) => {
      const offset = Number(pagination.cursor);
      return { events: events.slice(offset, offset + 5) };
    });

    let service = await import("../horizon-listener.service");
    await service.pollHorizonOnce();

    jest.resetModules();
    service = await import("../horizon-listener.service");
    await service.pollHorizonOnce();

    expect(mockGetEvents.mock.calls.map(([request]) => request.pagination.cursor)).toEqual([
      "0",
      "5",
    ]);
    expect(mockState.cursorUpdates).toEqual([
      "1", "2", "3", "4", "5",
      "6", "7", "8", "9", "10",
    ]);
    expect(new Set(mockState.cursorUpdates).size).toBe(10);
    expect(mockState.cursor).toBe("10");
  });

  it("moves a three-time failure to the DLQ and advances the cursor atomically", async () => {
    mockState.jobFailure = new Error("database write failed");
    const service = await import("../horizon-listener.service");

    await service.processHorizonEvent(
      makeEvent("42", ["escrow", "created"], [42]) as any,
    );

    expect(mockJobUpdateMany).toHaveBeenCalledTimes(3);
    expect(mockState.dlq).toHaveLength(1);
    expect(mockState.dlq[0]).toEqual(
      expect.objectContaining({
        cursor: "42",
        error: "database write failed",
        attempt: 3,
      }),
    );
    expect(mockState.cursorUpdates).toEqual(["42"]);
    expect(mockState.cursor).toBe("42");
  });
});
