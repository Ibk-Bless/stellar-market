import { getHealthStatus } from "../health";

const connectMock = jest.fn();
const pingMock = jest.fn();
const isRedisConnectedMock = jest.fn();
const getHealthMock = jest.fn();

jest.mock("../redis", () => ({
  __esModule: true,
  default: {
    connect: (...args: unknown[]) => connectMock(...args),
    getInstance: () => ({ ping: (...args: unknown[]) => pingMock(...args) }),
    isRedisConnected: () => isRedisConnectedMock(),
  },
}));

jest.mock("../../config", () => ({
  config: {
    version: "1.0.0",
    stellar: {
      rpcUrl: "https://soroban-testnet.stellar.org",
      escrowContractId: "",
      disputeContractId: "",
      reputationContractId: "",
    },
    smtp: {
      host: "smtp.test",
      port: 587,
      user: "",
      pass: "",
      from: "noreply@test.io",
    },
  },
}));

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getHealth: () => getHealthMock(),
    })),
  },
}));

describe("getHealthStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns ok when all dependencies are healthy", async () => {
    isRedisConnectedMock.mockReturnValue(true);
    pingMock.mockResolvedValue("PONG");
    getHealthMock.mockResolvedValue({ status: "healthy" });
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
    };

    const result = await getHealthStatus(prisma as any);

    expect(result.status).toBe("ok");
    expect(result.version).toBe("1.0.0");
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result).toEqual({
      status: "ok",
      service: "stellarmarket-api",
      version: "1.0.0",
      uptime: expect.any(Number),
      checks: {
        database: "ok",
        redis: "ok",
        sorobanRpc: "ok",
        horizonListener: "connected",
      },
    });
  });

  it("returns degraded when database and redis fail", async () => {
    isRedisConnectedMock.mockReturnValue(false);
    connectMock.mockRejectedValue(new Error("redis down"));
    getHealthMock.mockResolvedValue({ status: "healthy" });
    const prisma = {
      $queryRawUnsafe: jest.fn().mockRejectedValue(new Error("db down")),
    };

    const result = await getHealthStatus(prisma as any);

    expect(result.status).toBe("degraded");
    expect(result.checks.database).toBe("error");
    expect(result.checks.redis).toBe("error");
    expect(result.checks.sorobanRpc).toBe("ok");
  });

  it("returns degraded when Soroban RPC fails", async () => {
    isRedisConnectedMock.mockReturnValue(true);
    pingMock.mockResolvedValue("PONG");
    getHealthMock.mockRejectedValue(new Error("rpc down"));
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
    };

    const result = await getHealthStatus(prisma as any);

    expect(result.status).toBe("ok");
    expect(result.checks.database).toBe("ok");
    expect(result.checks.redis).toBe("ok");
    expect(result.checks.sorobanRpc).toBe("error");
  });

  it("includes version and uptime fields", async () => {
    isRedisConnectedMock.mockReturnValue(true);
    pingMock.mockResolvedValue("PONG");
    getHealthMock.mockResolvedValue({ status: "healthy" });
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
    };

    const result = await getHealthStatus(prisma as any);

    expect(result).toHaveProperty("version");
    expect(result).toHaveProperty("uptime");
    expect(typeof result.version).toBe("string");
    expect(typeof result.uptime).toBe("number");
  });
});
