import { logger } from "../../lib/logger";

jest.mock("../../lib/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../lib/request-context", () => ({
  getRequestId: jest.fn().mockReturnValue("test-trace-id"),
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
  MAX_PAGE_SIZE: 100,
}));

jest.mock("@stellar/stellar-sdk", () => {
  return {
    Contract: jest.fn().mockImplementation(() => ({ call: jest.fn().mockReturnValue({}) })),
    Address: jest.fn().mockImplementation(() => ({ toScVal: jest.fn().mockReturnValue({}) })),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ toXDR: jest.fn().mockReturnValue("base64-xdr==") }),
    })),
    BASE_FEE: "100",
    nativeToScVal: jest.fn().mockReturnValue({}),
    scValToNative: jest.fn().mockReturnValue("some-value"),
    xdr: { Operation: jest.fn() },
    rpc: {
      Server: jest.fn(),
      Api: {
        isSimulationError: jest.fn(),
        isSimulationSuccess: jest.fn(),
        GetTransactionStatus: { SUCCESS: "SUCCESS", FAILED: "FAILED" },
      },
    },
  };
});

import { rpc } from "@stellar/stellar-sdk";
import { ContractService, ContractSimulationError } from "../contract.service";

describe("ContractService simulation failure logging", () => {
  let mockSimulateTransaction: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSimulateTransaction = jest.fn();
    (rpc.Server as jest.Mock).mockImplementation(() => ({
      simulateTransaction: mockSimulateTransaction,
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 100 }),
      getAccount: jest.fn().mockResolvedValue({
        accountId: () => "GREADONLY",
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      }),
    }));

    (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
    (rpc.Api.isSimulationSuccess as unknown as jest.Mock).mockReturnValue(true);
  });

  it("logs xdr and events when simulateTransaction returns a simulation error", async () => {
    const fakeEvents = [{ type: "diagnostic", body: "contract trap" }];
    const fakeSimulation = { error: "contract execution failed", events: fakeEvents };

    (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue(fakeSimulation);

    await expect(ContractService.simulateContractRead({} as any)).rejects.toThrow(
      ContractSimulationError,
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "test-trace-id",
        xdr: expect.any(String),
        events: fakeEvents,
        error: "contract execution failed",
      }),
      "Soroban simulation failed",
    );
  });

  it("logs xdr and events when simulation does not succeed (restore needed)", async () => {
    const fakeSimulation = { events: [], restorePreamble: {} };

    (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
    (rpc.Api.isSimulationSuccess as unknown as jest.Mock).mockReturnValue(false);
    mockSimulateTransaction.mockResolvedValue(fakeSimulation);

    await expect(ContractService.simulateContractRead({} as any)).rejects.toThrow(
      ContractSimulationError,
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "test-trace-id",
        xdr: expect.any(String),
      }),
      "Soroban simulation did not succeed",
    );
  });

  it("does not log an error on successful simulation", async () => {
    const fakeSimulation = { result: { retval: {} }, events: [] };

    (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
    (rpc.Api.isSimulationSuccess as unknown as jest.Mock).mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue(fakeSimulation);

    await ContractService.simulateContractRead({} as any);

    expect(logger.error).not.toHaveBeenCalled();
  });
});
