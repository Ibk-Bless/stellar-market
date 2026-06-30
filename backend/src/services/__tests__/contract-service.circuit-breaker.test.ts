import { rpc } from "@stellar/stellar-sdk";
import { logger } from "../../lib/logger";

// Mock logger to avoid cluttering test output
jest.mock("../../lib/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../config", () => ({
  config: {
    stellar: {
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
      secondaryRpcUrl: "https://soroban-testnet.stellar.org/secondary",
      escrowContractId: "CDLZFC3SYJYDZT7K67VZ75YJBMKBAV27Z6Y6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z",
    },
  },
}));

jest.mock("@stellar/stellar-sdk", () => {
  const mockTxBuilder = {
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnThis(),
    toXDR: jest.fn().mockReturnValue("mock-xdr"),
  };

  return {
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue({}),
    })),
    Address: jest.fn().mockImplementation(() => ({
      toScVal: jest.fn().mockReturnValue({}),
    })),
    TransactionBuilder: jest.fn().mockImplementation(() => mockTxBuilder),
    BASE_FEE: "100",
    nativeToScVal: jest.fn().mockReturnValue({}),
    rpc: {
      Server: jest.fn(),
      Api: {
        GetTransactionStatus: {
          SUCCESS: "SUCCESS",
          FAILED: "FAILED",
        },
      },
    },
  };
});

import { ContractService } from "../contract.service";

describe("ContractService Circuit Breaker", () => {
  let mockPrimaryGetAccount: jest.Mock;
  let mockSecondaryGetAccount: jest.Mock;
  let mockPrimaryGetLatestLedger: jest.Mock;
  let mockSecondaryGetLatestLedger: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    const cb = ContractService.getCircuitBreaker();
    // Reset the circuit breaker state to closed
    cb.onSuccess();

    mockPrimaryGetAccount = jest.fn();
    mockSecondaryGetAccount = jest.fn();
    mockPrimaryGetLatestLedger = jest.fn().mockResolvedValue({});
    mockSecondaryGetLatestLedger = jest.fn().mockResolvedValue({});

    (rpc.Server as jest.Mock).mockImplementation((url) => {
      if (url && url.includes("secondary")) {
        return {
          getAccount: mockSecondaryGetAccount,
          getLatestLedger: mockSecondaryGetLatestLedger,
        };
      } else {
        return {
          getAccount: mockPrimaryGetAccount,
          getLatestLedger: mockPrimaryGetLatestLedger,
        };
      }
    });
  });

  it("should use primary RPC when circuit is CLOSED", async () => {
    mockPrimaryGetAccount.mockResolvedValueOnce({
      accountId: () => "GPRIMARY",
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    });

    const status = ContractService.getCircuitBreakerStatus();
    expect(status.state).toBe("CLOSED");

    const result = await ContractService.buildCreateJobTx(
      "GPRIMARY",
      "GFREELANCER",
      "CTOKEN",
      [],
      123456
    );

    expect(result).toBeDefined();
    expect(mockPrimaryGetLatestLedger).toHaveBeenCalledTimes(1);
    expect(mockPrimaryGetAccount).toHaveBeenCalledTimes(1);
    expect(mockSecondaryGetAccount).not.toHaveBeenCalled();
    expect(ContractService.getCircuitBreakerStatus().state).toBe("CLOSED");
  });

  it("should open circuit after 5 failures and route to secondary RPC", async () => {
    mockPrimaryGetLatestLedger.mockRejectedValue(new Error("Primary RPC Error"));
    mockSecondaryGetAccount.mockResolvedValue({
      accountId: () => "GSECONDARY",
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    });

    // Perform 4 failing calls to primary
    for (let i = 0; i < 4; i++) {
      await expect(
        ContractService.buildCreateJobTx("GPRIMARY", "GFREELANCER", "CTOKEN", [], 123456)
      ).rejects.toThrow("Primary RPC Error");
    }

    expect(ContractService.getCircuitBreakerStatus().state).toBe("CLOSED");
    expect(ContractService.getCircuitBreakerStatus().consecutiveFailures).toBe(4);

    // The 5th call should open the circuit, and immediately fall back to secondary.
    // So the call should succeed using secondary!
    const result = await ContractService.buildCreateJobTx(
      "GPRIMARY",
      "GFREELANCER",
      "CTOKEN",
      [],
      123456
    );

    expect(result).toBeDefined();
    expect(ContractService.getCircuitBreakerStatus().state).toBe("OPEN");
    expect(mockPrimaryGetLatestLedger).toHaveBeenCalledTimes(5);
    expect(mockSecondaryGetLatestLedger).toHaveBeenCalledTimes(1);
    expect(mockSecondaryGetAccount).toHaveBeenCalledTimes(1);

    // A 6th call while open should bypass primary entirely and call secondary.
    mockPrimaryGetLatestLedger.mockClear();
    mockSecondaryGetLatestLedger.mockClear();
    mockSecondaryGetAccount.mockClear();
    
    const result6 = await ContractService.buildCreateJobTx(
      "GPRIMARY",
      "GFREELANCER",
      "CTOKEN",
      [],
      123456
    );
    expect(result6).toBeDefined();
    expect(mockPrimaryGetLatestLedger).not.toHaveBeenCalled();
    expect(mockSecondaryGetLatestLedger).toHaveBeenCalledTimes(1);
    expect(mockSecondaryGetAccount).toHaveBeenCalledTimes(1);
  });

  it("should throw a 503 error when both primary and secondary RPCs fail", async () => {
    mockPrimaryGetLatestLedger.mockRejectedValue(new Error("Primary RPC Error"));
    mockSecondaryGetLatestLedger.mockRejectedValue(new Error("Secondary RPC Error"));

    // Force circuit to open
    for (let i = 0; i < 4; i++) {
      await expect(
        ContractService.buildCreateJobTx("GPRIMARY", "GFREELANCER", "CTOKEN", [], 123456)
      ).rejects.toThrow("Primary RPC Error");
    }

    // 5th failure should trigger primary fail + secondary fail -> throws 503
    let error: any;
    try {
      await ContractService.buildCreateJobTx("GPRIMARY", "GFREELANCER", "CTOKEN", [], 123456);
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.statusCode).toBe(503);
    expect(error.message).toBe("Stellar RPC services unavailable");
    expect(ContractService.getCircuitBreakerStatus().state).toBe("OPEN");
  });

  it("should transition to HALF_OPEN and probe primary RPC after 60s cooldown", async () => {
    jest.useFakeTimers();

    mockPrimaryGetLatestLedger.mockRejectedValue(new Error("Primary RPC Error"));
    mockSecondaryGetAccount.mockResolvedValue({
      accountId: () => "GSECONDARY",
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    });

    // Manually force the circuit breaker to OPEN state by failing 5 times
    const cb = ContractService.getCircuitBreaker();
    for (let i = 0; i < 5; i++) {
      cb.onFailure();
    }
    expect(ContractService.getCircuitBreakerStatus().state).toBe("OPEN");

    // Advance timer by 61 seconds
    jest.advanceTimersByTime(61000);

    // Next call should probe primary
    mockPrimaryGetLatestLedger.mockClear();
    mockPrimaryGetLatestLedger.mockResolvedValueOnce({});
    mockPrimaryGetAccount.mockResolvedValueOnce({
      accountId: () => "GPRIMARY",
      sequenceNumber: () => "2",
      incrementSequenceNumber: () => {},
    });
    mockSecondaryGetLatestLedger.mockClear();

    const result = await ContractService.buildCreateJobTx(
      "GPRIMARY",
      "GFREELANCER",
      "CTOKEN",
      [],
      123456
    );

    expect(result).toBeDefined();
    expect(mockPrimaryGetLatestLedger).toHaveBeenCalledTimes(1);
    expect(mockPrimaryGetAccount).toHaveBeenCalledTimes(1);
    expect(mockSecondaryGetLatestLedger).not.toHaveBeenCalled();
    expect(ContractService.getCircuitBreakerStatus().state).toBe("CLOSED");

    jest.useRealTimers();
  });
});
