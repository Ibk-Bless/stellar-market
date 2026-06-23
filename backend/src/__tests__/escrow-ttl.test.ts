import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockJobFindMany = jest.fn() as jest.MockedFunction<any>;
const mockNotificationFindMany = jest.fn() as jest.MockedFunction<any>;
const mockNotificationCreate = jest.fn() as jest.MockedFunction<any>;

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    job: {
      findMany: mockJobFindMany,
    },
    notification: {
      findMany: mockNotificationFindMany,
      create: mockNotificationCreate,
    },
  })),
}));

const mockGetEscrowTtl = jest.fn() as jest.MockedFunction<any>;
jest.mock("../lib/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn((...args) => console.error("LOGGER ERROR:", ...args)),
    debug: jest.fn(),
  },
}));

jest.mock("../services/contract.service", () => ({
  ContractService: {
    getEscrowTtl: mockGetEscrowTtl,
  },
}));

const mockSendNotification = jest.fn() as jest.MockedFunction<any>;
jest.mock("../services/notification.service", () => ({
  NotificationService: {
    sendNotification: mockSendNotification,
  },
}));

const mockSendTransaction = jest.fn() as jest.MockedFunction<any>;
const mockGetAccount = jest.fn() as jest.MockedFunction<any>;

jest.mock("@stellar/stellar-sdk", () => {
  const mockKeypair = {
    publicKey: () => "GBKEEPERKEY123456789012345678901234567890123456789012345",
    sign: () => Buffer.alloc(64),
  };
  
  const mockTxBuilder = {
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnThis(),
    sign: jest.fn().mockReturnThis(),
    toXDR: jest.fn().mockReturnValue("mock-xdr"),
  };

  return {
    Keypair: {
      fromSecret: jest.fn().mockReturnValue(mockKeypair),
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue("mock-operation"),
    })),
    TransactionBuilder: jest.fn().mockImplementation(() => mockTxBuilder),
    BASE_FEE: "100",
    nativeToScVal: jest.fn(),
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        sendTransaction: mockSendTransaction,
        getAccount: mockGetAccount,
      })),
    },
  };
});

jest.mock("../config", () => ({
  config: {
    stellar: {
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
      escrowContractId: "CC123",
      keeperSecretKey: "SCSIGNERKEY123456789012345678901234567890123456789012345",
    },
  },
}));

import { checkEscrowTtls } from "../jobs/escrow-ttl.job";

describe("checkEscrowTtls job", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should not alert or extend if daysRemaining >= 14", async () => {
    mockJobFindMany.mockResolvedValue([
      { id: "job-1", title: "Test Job 1", contractJobId: "1", clientId: "client-1" },
    ]);
    mockGetEscrowTtl.mockResolvedValue({
      daysRemaining: 15,
      currentLedger: 100,
      expiryLedger: 359200,
    });

    await checkEscrowTtls();

    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it("should alert client if daysRemaining < 14 and not alerted in the last 24h", async () => {
    mockJobFindMany.mockResolvedValue([
      { id: "job-1", title: "Test Job 1", contractJobId: "1", clientId: "client-1" },
    ]);
    mockGetEscrowTtl.mockResolvedValue({
      daysRemaining: 12,
      currentLedger: 100,
      expiryLedger: 207460,
    });
    mockNotificationFindMany.mockResolvedValue([]); // no alerts in the last 24h

    await checkEscrowTtls();

    expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: "client-1",
      type: "ESCROW_TTL_WARNING",
      title: "Escrow Expiry Warning",
    }));
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it("should not alert client if daysRemaining < 14 but already alerted in the last 24h", async () => {
    mockJobFindMany.mockResolvedValue([
      { id: "job-1", title: "Test Job 1", contractJobId: "1", clientId: "client-1" },
    ]);
    mockGetEscrowTtl.mockResolvedValue({
      daysRemaining: 12,
      currentLedger: 100,
      expiryLedger: 207460,
    });
    mockNotificationFindMany.mockResolvedValue([
      { id: "notif-1", userId: "client-1", type: "ESCROW_TTL_WARNING", metadata: { jobId: "job-1" } },
    ]);

    await checkEscrowTtls();

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("should proactively extend if daysRemaining < 7", async () => {
    mockJobFindMany.mockResolvedValue([
      { id: "job-1", title: "Test Job 1", contractJobId: "1", clientId: "client-1" },
    ]);
    mockGetEscrowTtl.mockResolvedValue({
      daysRemaining: 5,
      currentLedger: 100,
      expiryLedger: 86500,
    });
    mockNotificationFindMany.mockResolvedValue([]);
    mockGetAccount.mockResolvedValue({
      accountId: () => "GBKEEPERKEY123456789012345678901234567890123456789012345",
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    });
    mockSendTransaction.mockResolvedValue({
      status: "PENDING",
      hash: "tx-hash-123",
    });

    await checkEscrowTtls();

    expect(mockSendNotification).toHaveBeenCalled();
    expect(mockSendTransaction).toHaveBeenCalled();
  });
});
