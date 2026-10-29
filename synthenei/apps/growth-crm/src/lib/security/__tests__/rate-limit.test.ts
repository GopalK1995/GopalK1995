import { describe, expect, it } from "vitest";
import { memoryStore, rateLimit } from "../rate-limit";

describe("rate limit", () => {
  it("allows up to the limit then blocks, per key, and resets after the window", async () => {
    const store = memoryStore();
    const cfg = { limit: 3, windowMs: 1000 };
    for (let i = 0; i < 3; i++) expect((await rateLimit("login", "a", cfg, { store, now: 0 })).ok).toBe(true);
    const blocked = await rateLimit("login", "a", cfg, { store, now: 500 });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
    expect((await rateLimit("login", "b", cfg, { store, now: 500 })).ok).toBe(true);
    expect((await rateLimit("login", "a", cfg, { store, now: 1001 })).ok).toBe(true);
  });
});
