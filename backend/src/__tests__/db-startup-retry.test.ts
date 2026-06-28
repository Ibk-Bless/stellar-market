/**
 * Tests for #804: backend retries the Prisma $connect() call with
 * exponential back-off before giving up and crashing.
 */

jest.mock("../lib/logger", () => ({
  installRequestIdConsolePatch: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { logger } from "../lib/logger";
import { connectWithRetry } from "../lib/db-connect";

const mockConnect = jest.fn();
const mockPrisma = { $connect: mockConnect } as any;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("connectWithRetry (#804)", () => {
  it("connects immediately when DB is available on the first attempt", async () => {
    mockConnect.mockResolvedValueOnce(undefined);

    await connectWithRetry(mockPrisma);

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("retries after failure and succeeds on the third attempt", async () => {
    const connError = new Error("ECONNREFUSED");
    mockConnect
      .mockRejectedValueOnce(connError)
      .mockRejectedValueOnce(connError)
      .mockResolvedValueOnce(undefined);

    const promise = connectWithRetry(mockPrisma, 5, 100);
    await jest.runAllTimersAsync();
    await promise;

    expect(mockConnect).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("logs a warn message for each failed attempt with retry info", async () => {
    const connError = new Error("ECONNREFUSED");
    mockConnect
      .mockRejectedValueOnce(connError)
      .mockResolvedValueOnce(undefined);

    const promise = connectWithRetry(mockPrisma, 5, 100);
    await jest.runAllTimersAsync();
    await promise;

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect((logger.warn as jest.Mock).mock.calls[0][0]).toMatch(/DB not ready.*attempt 1\/5/);
  });

  it("throws after exhausting all retries", async () => {
    const connError = new Error("ECONNREFUSED");
    mockConnect.mockRejectedValue(connError);

    const promise = connectWithRetry(mockPrisma, 3, 100);
    // Run timers concurrently so the retries advance without deadlocking
    void jest.runAllTimersAsync();

    await expect(promise).rejects.toThrow("ECONNREFUSED");
    expect(mockConnect).toHaveBeenCalledTimes(3);
  });
});
