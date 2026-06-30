jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { withUpstreamTimeout, UpstreamTimeoutError } from "../upstream-timeout";

describe("withUpstreamTimeout", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves with the wrapped call's value when it completes in time", async () => {
    const result = await withUpstreamTimeout(async () => "ok", {
      route: "test.route",
      target: "horizon.test",
    });
    expect(result).toBe("ok");
  });

  it("rejects with UpstreamTimeoutError after the configured timeout", async () => {
    const fn = () => new Promise<string>(() => {}); // never resolves
    const promise = withUpstreamTimeout(fn, {
      route: "test.route",
      target: "horizon.test",
      timeoutMs: 10_000,
    });

    jest.advanceTimersByTime(10_000);

    await expect(promise).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("defaults the timeout error code to HorizonUnavailable", async () => {
    const fn = () => new Promise<string>(() => {});
    const promise = withUpstreamTimeout(fn, { route: "test.route", target: "horizon.test" });

    jest.advanceTimersByTime(10_000);

    await expect(promise).rejects.toMatchObject({ code: "HorizonUnavailable", statusCode: 502 });
  });

  it("uses the provided error code on expiry", async () => {
    const fn = () => new Promise<string>(() => {});
    const promise = withUpstreamTimeout(fn, {
      route: "test.route",
      target: "soroban-rpc",
      code: "OracleUnavailable",
    });

    jest.advanceTimersByTime(10_000);

    await expect(promise).rejects.toMatchObject({ code: "OracleUnavailable", statusCode: 502 });
  });

  it("propagates a non-timeout rejection as-is", async () => {
    const fn = async () => {
      throw new Error("boom");
    };

    await expect(
      withUpstreamTimeout(fn, { route: "test.route", target: "horizon.test" }),
    ).rejects.toThrow("boom");
  });
});
