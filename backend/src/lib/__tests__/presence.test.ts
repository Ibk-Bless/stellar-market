import { FakeRedisBus } from "./testUtils/fakeRedis";

// Short TTL/heartbeat so the crash-expiry assertions don't need to wait long.
// Must be set before `../presence` is first required below, since it reads
// these once at module load time.
process.env.PRESENCE_TTL_SECONDS = "1";
process.env.PRESENCE_HEARTBEAT_MS = "300";

const bus = new FakeRedisBus();
(global as any).__PRESENCE_TEST_BUS__ = bus;

jest.mock("../redis", () => {
  const { mockRedisModule } = require("./testUtils/fakeRedis");
  return mockRedisModule((global as any).__PRESENCE_TEST_BUS__);
});

// Loaded via require (not a top-level import) so it resolves *after* the
// process.env assignments above — a hoisted `import` would run before them.
const {
  isUserOnline,
  markSocketOnline,
  markSocketOffline,
  refreshSocketPresence,
  startPresenceHeartbeat,
} = require("../presence") as typeof import("../presence");

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("presence registry", () => {
  it("reports a user offline until a socket registers", async () => {
    expect(await isUserOnline("user-1")).toBe(false);
    await markSocketOnline("user-1", "socket-1");
    expect(await isUserOnline("user-1")).toBe(true);
  });

  it("stays online with multiple concurrent sockets and only goes offline once all are removed", async () => {
    await markSocketOnline("user-2", "socket-a");
    await markSocketOnline("user-2", "socket-b");
    expect(await isUserOnline("user-2")).toBe(true);

    await markSocketOffline("user-2", "socket-a");
    expect(await isUserOnline("user-2")).toBe(true);

    await markSocketOffline("user-2", "socket-b");
    expect(await isUserOnline("user-2")).toBe(false);
  });

  it("goes offline immediately on a clean disconnect", async () => {
    await markSocketOnline("user-3", "socket-1");
    expect(await isUserOnline("user-3")).toBe(true);

    await markSocketOffline("user-3", "socket-1");
    expect(await isUserOnline("user-3")).toBe(false);
  });

  it("expires presence via TTL when a socket disappears without a clean disconnect (simulated crash)", async () => {
    await markSocketOnline("user-4", "socket-crash");
    expect(await isUserOnline("user-4")).toBe(true);

    // No markSocketOffline call — simulates the owning instance being killed
    // before it can clean up. The TTL (1s) must expire the entry on its own.
    await wait(1200);

    expect(await isUserOnline("user-4")).toBe(false);
  });

  it("stays online across TTL windows as long as the heartbeat keeps refreshing", async () => {
    await markSocketOnline("user-5", "socket-live");
    const heartbeat = startPresenceHeartbeat("user-5", "socket-live");

    try {
      await wait(1500); // longer than the 1s TTL; heartbeat refreshes every 300ms
      expect(await isUserOnline("user-5")).toBe(true);
    } finally {
      clearInterval(heartbeat);
    }

    // once the heartbeat stops, the key expires like any crashed instance
    await wait(1200);
    expect(await isUserOnline("user-5")).toBe(false);
  });

  it("recreates an already-expired key on refresh rather than silently no-op'ing", async () => {
    await markSocketOnline("user-6", "socket-1");
    await wait(1200);
    expect(await isUserOnline("user-6")).toBe(false);

    await refreshSocketPresence("user-6", "socket-1");
    expect(await isUserOnline("user-6")).toBe(true);
  });
});
