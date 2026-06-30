jest.mock("../../lib/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { EventEmitter } from "events";
import { requestTimeoutMiddleware, REQUEST_TIMEOUT_MS } from "../timeout";
import { logger } from "../../lib/logger";

function makeRes() {
  const res = new EventEmitter() as any;
  res.headersSent = false;
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.end = jest.fn();
  return res;
}

describe("requestTimeoutMiddleware", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("calls next immediately and does not respond before the timeout elapses", () => {
    const req: any = { originalUrl: "/api/jobs", method: "GET", requestId: "req-1" };
    const res = makeRes();
    const next = jest.fn();

    requestTimeoutMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS - 1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 503 RequestTimeout and logs a warning once the timeout elapses", () => {
    const req: any = { originalUrl: "/api/escrow/job-1/ttl", method: "GET", requestId: "req-2" };
    const res = makeRes();
    const next = jest.fn();

    requestTimeoutMiddleware(req, res, next);
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "RequestTimeout", requestId: "req-2" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ route: "/api/escrow/job-1/ttl", method: "GET" }),
      "Request timed out",
    );
  });

  it("does not fire the timeout once the response has already finished", () => {
    const req: any = { originalUrl: "/api/jobs", method: "GET", requestId: "req-3" };
    const res = makeRes();
    const next = jest.fn();

    requestTimeoutMiddleware(req, res, next);
    res.emit("finish");
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);

    expect(res.status).not.toHaveBeenCalled();
  });

  it("does not double-respond if headers were already sent", () => {
    const req: any = { originalUrl: "/api/jobs", method: "GET", requestId: "req-4" };
    const res = makeRes();
    res.headersSent = true;
    const next = jest.fn();

    requestTimeoutMiddleware(req, res, next);
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });
});
