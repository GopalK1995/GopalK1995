// Provider adapter contract: every adapter, given the vendor's response shape (fixtures in ./fixtures), must return the same
// CompleteResult, retry 429/5xx with backoff, fail without echoing the key or the prompt, and never retry a 4xx.
import { describe, expect, it, vi } from "vitest";
import anthropicOk from "./fixtures/anthropic-ok.json";
import openaiOk from "./fixtures/openai-ok.json";
import googleOk from "./fixtures/google-ok.json";
import { ADAPTERS, adapterFor, mockEnabled } from "../providers";
import { AiError, PROVIDER_IDS, type CompleteRequest, type ProviderId } from "../types";

const FIXTURE: Record<ProviderId, unknown> = { anthropic: anthropicOk, openai: openaiOk, google: googleOk };
const KEY = "sk-test-0123456789abcdef";
const REQ: CompleteRequest = { model: "m-1", system: "You assist.", messages: [{ role: "user", content: "SECRET PROMPT TEXT" }], maxTokens: 200, temperature: 0.2 };
const res = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const sleep = vi.fn(async () => undefined);

describe.each(PROVIDER_IDS)("adapter contract: %s", (id) => {
  const a = ADAPTERS[id];
  it("maps the recorded response to text, tokens and model", async () => {
    const fetchImpl = vi.fn(async () => res(200, FIXTURE[id])) as unknown as typeof fetch;
    const r = await a.complete(REQ, { apiKey: KEY, fetchImpl, sleep });
    expect(r.text).toBe("Hello Asha, thanks for your message.");
    expect([r.inputTokens, r.outputTokens]).toEqual([412, 23]);
    expect(typeof r.model).toBe("string");
  });

  it("sends the key only in a header, never in the URL or body, and the model in the right place", async () => {
    const fetchImpl = vi.fn(async () => res(200, FIXTURE[id]));
    await a.complete(REQ, { apiKey: KEY, fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(KEY);
    expect(String(init.body)).not.toContain(KEY);
    expect(JSON.stringify(init.headers)).toContain(KEY);
    expect(id === "google" ? url : String(init.body)).toContain("m-1");
  });

  it("retries a 429 with backoff, honouring Retry-After, then succeeds", async () => {
    const calls: number[] = [];
    const fetchImpl = vi.fn(async () => (calls.push(1), calls.length < 3 ? res(429, { error: "slow down" }, { "retry-after": "2" }) : res(200, FIXTURE[id]))) as unknown as typeof fetch;
    const waits: number[] = [];
    const r = await a.complete(REQ, { apiKey: KEY, fetchImpl, sleep: async (ms) => { waits.push(ms); } });
    expect(r.outputTokens).toBe(23);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([2000, 2000]);
  });

  it("gives up after the retries on persistent 429 (rate_limited) and on 5xx (provider_error)", async () => {
    const f429 = vi.fn(async () => res(429, {})) as unknown as typeof fetch;
    await expect(a.complete(REQ, { apiKey: KEY, fetchImpl: f429, sleep })).rejects.toMatchObject({ code: "rate_limited" });
    expect(f429).toHaveBeenCalledTimes(3);
    const f503 = vi.fn(async () => res(503, {})) as unknown as typeof fetch;
    await expect(a.complete(REQ, { apiKey: KEY, fetchImpl: f503, sleep })).rejects.toMatchObject({ code: "provider_error" });
  });

  it("does not retry a 401 and the error text carries neither key nor prompt", async () => {
    const fetchImpl = vi.fn(async () => res(401, { error: { message: `bad key ${KEY} for SECRET PROMPT TEXT` } })) as unknown as typeof fetch;
    const e = await a.complete(REQ, { apiKey: KEY, fetchImpl, sleep }).catch((x) => x as AiError);
    expect(e).toBeInstanceOf(AiError);
    expect(e.code).toBe("provider_error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([e.message, e.detail])).not.toMatch(/sk-test|SECRET PROMPT/);
  });

  it("treats a network failure as provider_error and an empty completion as bad_output", async () => {
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(a.complete(REQ, { apiKey: KEY, fetchImpl: down, sleep })).rejects.toMatchObject({ code: "provider_error" });
    const empty = vi.fn(async () => res(200, {})) as unknown as typeof fetch;
    await expect(a.complete(REQ, { apiKey: KEY, fetchImpl: empty, sleep })).rejects.toMatchObject({ code: "bad_output" });
  });
});

describe("adapter specifics", () => {
  it("anthropic uses the messages API with a version header; openai asks for JSON mode; google for a JSON mime type", async () => {
    const seen: Record<string, [string, RequestInit]> = {};
    const f = (id: ProviderId) => (async (u: string, i: RequestInit) => { seen[id] = [u, i]; return res(200, FIXTURE[id]); }) as unknown as typeof fetch;
    await ADAPTERS.anthropic.complete({ ...REQ, json: true }, { apiKey: KEY, fetchImpl: f("anthropic"), sleep });
    await ADAPTERS.openai.complete({ ...REQ, json: true }, { apiKey: KEY, fetchImpl: f("openai"), sleep });
    await ADAPTERS.google.complete({ ...REQ, json: true }, { apiKey: KEY, fetchImpl: f("google"), sleep });
    expect(seen.anthropic[0]).toBe("https://api.anthropic.com/v1/messages");
    expect((seen.anthropic[1].headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(String(seen.openai[1].body)).response_format).toEqual({ type: "json_object" });
    expect(JSON.parse(String(seen.google[1].body)).generationConfig.responseMimeType).toBe("application/json");
  });

  it("honours a base URL override (staging stubs)", async () => {
    const fetchImpl = vi.fn(async () => res(200, anthropicOk));
    await ADAPTERS.anthropic.complete(REQ, { apiKey: KEY, fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "http://stub.local", sleep });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("http://stub.local/v1/messages");
  });

  it("the mock provider answers only outside production and only when switched on", () => {
    expect(mockEnabled({})).toBe(false);
    expect(mockEnabled({ AI_MOCK_PROVIDER: "1" })).toBe(true);
    expect(mockEnabled({ AI_MOCK_PROVIDER: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(mockEnabled({ AI_MOCK_PROVIDER: "1", NODE_ENV: "production" })).toBe(false);
    expect(adapterFor("openai", {})).toBe(ADAPTERS.openai);
  });
});
