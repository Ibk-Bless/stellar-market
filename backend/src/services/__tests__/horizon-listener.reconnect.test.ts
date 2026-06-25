/**
 * Tests for the HorizonListener reconnect backoff (#707).
 *
 * Mirrors the mocking strategy used in horizon-listener.circuit-breaker.test.ts
 * so the module loads without a real Prisma/Stellar SDK connection.
 */

jest.mock("../../lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: { Server: jest.fn().mockImplementation(() => ({})) },
  scValToNative: jest.fn(),
}));

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({})),
  BadgeTier: {},
}));

jest.mock("../notification.service", () => ({
  NotificationService: { sendNotification: jest.fn() },
}));

jest.mock("../../config", () => ({
  config: {
    stellar: {
      rpcUrl: "https://mock",
      escrowContractId: "C1",
      disputeContractId: "C2",
      reputationContractId: "C3",
    },
  },
}));

import { computeReconnectBackoffMs } from "../horizon-listener.service";

describe("computeReconnectBackoffMs", () => {
  it("returns 0 when there are no failures", () => {
    expect(computeReconnectBackoffMs(0)).toBe(0);
  });

  it("doubles starting from 1s for each consecutive failure", () => {
    expect(computeReconnectBackoffMs(1)).toBe(1_000);
    expect(computeReconnectBackoffMs(2)).toBe(2_000);
    expect(computeReconnectBackoffMs(3)).toBe(4_000);
    expect(computeReconnectBackoffMs(4)).toBe(8_000);
    expect(computeReconnectBackoffMs(5)).toBe(16_000);
    expect(computeReconnectBackoffMs(6)).toBe(32_000);
  });

  it("caps the backoff at 60s", () => {
    expect(computeReconnectBackoffMs(7)).toBe(60_000);
    expect(computeReconnectBackoffMs(20)).toBe(60_000);
  });
});
