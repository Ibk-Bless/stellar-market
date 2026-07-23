import { EventEmitter } from "events";

/**
 * Minimal in-memory stand-in for an ioredis client, shared by every
 * `FakeRedisClient` bound to the same `FakeRedisBus`. This is enough surface
 * area to exercise our presence registry (get/set/expire/sadd/srem/smembers,
 * pipeline) and @socket.io/redis-adapter (publish/subscribe/psubscribe using
 * the *Buffer event names ioredis emits), without a real Redis server.
 *
 * Multiple `FakeRedisClient`s pointed at the same bus simulate multiple app
 * instances (or a client + its pub/sub duplicates) talking to one physical
 * Redis.
 */

interface StoreEntry {
  value: string;
  expiresAt: number | null;
}

function isExpired(entry: StoreEntry | undefined): boolean {
  return !entry || (entry.expiresAt !== null && entry.expiresAt <= Date.now());
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export class FakeRedisBus {
  store = new Map<string, StoreEntry>();
  channelSubscribers = new Map<string, Set<FakeRedisClient>>();
  patternSubscribers = new Map<string, { regex: RegExp; clients: Set<FakeRedisClient> }>();
}

type PipelineOp = () => Promise<unknown>;

export class FakeRedisClient extends EventEmitter {
  status = "ready";

  constructor(private readonly bus: FakeRedisBus) {
    super();
    this.setMaxListeners(0);
  }

  duplicate(): FakeRedisClient {
    return new FakeRedisClient(this.bus);
  }

  async connect(): Promise<void> {}
  async quit(): Promise<void> {}
  async disconnect(): Promise<void> {}

  private read(key: string): string | null {
    const entry = this.bus.store.get(key);
    if (isExpired(entry)) {
      this.bus.store.delete(key);
      return null;
    }
    return entry!.value;
  }

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<"OK"> {
    let expiresAt: number | null = null;
    const exIndex = args.findIndex((a) => a === "EX");
    if (exIndex !== -1) {
      expiresAt = Date.now() + Number(args[exIndex + 1]) * 1000;
    }
    this.bus.store.set(key, { value: String(value), expiresAt });
    return "OK";
  }

  async expire(key: string, seconds: number): Promise<0 | 1> {
    const entry = this.bus.store.get(key);
    if (isExpired(entry)) {
      this.bus.store.delete(key);
      return 0;
    }
    entry!.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.bus.store.delete(key)) count++;
    }
    return count;
  }

  async exists(...keys: string[]): Promise<number> {
    return keys.reduce((count, key) => count + (this.read(key) !== null ? 1 : 0), 0);
  }

  async incr(key: string): Promise<number> {
    const current = Number(this.read(key) ?? "0");
    const next = current + 1;
    const entry = this.bus.store.get(key);
    this.bus.store.set(key, { value: String(next), expiresAt: entry && !isExpired(entry) ? entry.expiresAt : null });
    return next;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const entry = this.bus.store.get(key);
    const set = new Set<string>(entry && !isExpired(entry) ? JSON.parse(entry.value) : []);
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    this.bus.store.set(key, { value: JSON.stringify([...set]), expiresAt: null });
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const entry = this.bus.store.get(key);
    if (isExpired(entry)) return 0;
    const set = new Set<string>(JSON.parse(entry!.value));
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    this.bus.store.set(key, { value: JSON.stringify([...set]), expiresAt: null });
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    const value = this.read(key);
    return value ? JSON.parse(value) : [];
  }

  pipeline() {
    const ops: PipelineOp[] = [];
    const builder = {
      exists: (key: string) => {
        ops.push(() => this.exists(key));
        return builder;
      },
      get: (key: string) => {
        ops.push(() => this.get(key));
        return builder;
      },
      exec: async (): Promise<Array<[Error | null, unknown]>> => {
        const results: Array<[Error | null, unknown]> = [];
        for (const op of ops) {
          try {
            results.push([null, await op()]);
          } catch (err) {
            results.push([err as Error, null]);
          }
        }
        return results;
      },
    };
    return builder;
  }

  publish(channel: string, message: string | Buffer): number {
    let count = 0;
    const msgBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);
    const channelBuffer = Buffer.from(channel);

    const exact = this.bus.channelSubscribers.get(channel);
    if (exact) {
      for (const client of exact) {
        client.emit("messageBuffer", channelBuffer, msgBuffer);
        count++;
      }
    }

    for (const { regex, clients } of this.bus.patternSubscribers.values()) {
      if (regex.test(channel)) {
        for (const client of clients) {
          client.emit("pmessageBuffer", Buffer.from(regex.source), channelBuffer, msgBuffer);
          count++;
        }
      }
    }
    return count;
  }

  subscribe(channels: string | string[], _cb?: unknown): void {
    const list = Array.isArray(channels) ? channels : [channels];
    for (const channel of list) {
      if (!this.bus.channelSubscribers.has(channel)) {
        this.bus.channelSubscribers.set(channel, new Set());
      }
      this.bus.channelSubscribers.get(channel)!.add(this);
    }
  }

  unsubscribe(channels?: string | string[]): void {
    const list = channels
      ? Array.isArray(channels)
        ? channels
        : [channels]
      : [...this.bus.channelSubscribers.keys()];
    for (const channel of list) {
      this.bus.channelSubscribers.get(channel)?.delete(this);
    }
  }

  psubscribe(pattern: string): void {
    if (!this.bus.patternSubscribers.has(pattern)) {
      this.bus.patternSubscribers.set(pattern, { regex: globToRegex(pattern), clients: new Set() });
    }
    this.bus.patternSubscribers.get(pattern)!.clients.add(this);
  }

  punsubscribe(pattern?: string): void {
    if (pattern) {
      this.bus.patternSubscribers.get(pattern)?.clients.delete(this);
    } else {
      for (const entry of this.bus.patternSubscribers.values()) entry.clients.delete(this);
    }
  }
}

export function createFakeRedisClient(bus: FakeRedisBus): FakeRedisClient {
  return new FakeRedisClient(bus);
}

/**
 * jest.mock("../../lib/redis", () => require(".../mockRedisModule").mockRedisModule(bus))
 * gives every caller of `RedisClient.getInstance()` the same client bound to `bus`,
 * mirroring how every app instance shares one physical Redis server.
 */
export function mockRedisModule(bus: FakeRedisBus) {
  const client = createFakeRedisClient(bus);
  return {
    __esModule: true,
    default: {
      getInstance: () => client,
      isRedisConnected: () => true,
      connect: async () => {},
      disconnect: async () => {},
    },
  };
}
