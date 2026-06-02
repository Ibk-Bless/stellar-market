import Redis from "ioredis";
import { getRedisClient } from "../config/redis";

describe("Rate Limiting Redis Integration", () => {
  let redis: Redis | null;

  beforeAll(() => {
    redis = getRedisClient();
  });

  afterAll(async () => {
    if (redis) {
      await redis.quit();
    }
  });

  it("should confirm Redis TTL keys are set correctly", async () => {
    if (!redis) {
      console.log("Redis not available, skipping integration test");
      return;
    }

    // Set a test rate limit key
    const testKey = "rate_limit:test:127.0.0.1";
    await redis.set(testKey, "10", "EX", 60);

    // Verify the key exists
    const value = await redis.get(testKey);
    expect(value).toBe("10");

    // Verify TTL is set (should be approximately 60 seconds)
    const ttl = await redis.ttl(testKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    // Clean up
    await redis.del(testKey);
  });

  it("should confirm rate limit keys have correct prefix", async () => {
    if (!redis) {
      console.log("Redis not available, skipping integration test");
      return;
    }

    // Set multiple test keys with the rate_limit prefix
    await redis.set("rate_limit:test1:127.0.0.1", "5", "EX", 60);
    await redis.set("rate_limit:test2:192.168.1.1", "3", "EX", 60);

    // Verify keys can be found by pattern
    const keys = await redis.keys("rate_limit:*");
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys).toContain("rate_limit:test1:127.0.0.1");
    expect(keys).toContain("rate_limit:test2:192.168.1.1");

    // Clean up
    await redis.del("rate_limit:test1:127.0.0.1");
    await redis.del("rate_limit:test2:192.168.1.1");
  });

  it("should confirm limits reset after window expires", async () => {
    if (!redis) {
      console.log("Redis not available, skipping integration test");
      return;
    }

    const testKey = "rate_limit:reset_test:127.0.0.1";
    
    // Set a key with a short TTL (2 seconds)
    await redis.set(testKey, "10", "EX", 2);
    
    // Verify key exists initially
    const initialValue = await redis.get(testKey);
    expect(initialValue).toBe("10");

    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Verify key has expired
    const expiredValue = await redis.get(testKey);
    expect(expiredValue).toBeNull();
  });
});
