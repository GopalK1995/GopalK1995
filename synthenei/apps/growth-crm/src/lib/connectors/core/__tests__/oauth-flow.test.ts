import { describe, expect, it } from "vitest";
import { checkCallback, type CallbackInput } from "../oauth-flow";
import { signCookie, stateHash, type OAuthCookie } from "../oauth";

const SECRET = "flow-secret-not-real";
const NOW = 1_800_000_000_000;
const COOKIE: OAuthCookie = { state: "state-1234", verifier: "v", ws: "w-1", uid: "u-1", connector: "hubspot", conn: null, exp: NOW + 600_000, returnTo: "/integrations/hubspot" };

function input(over: Partial<CallbackInput> = {}, used = new Set<string>()): CallbackInput {
  return {
    connector: "hubspot", query: { code: "abc", state: "state-1234" }, cookieToken: signCookie(COOKIE, SECRET), secret: SECRET, uid: "u-1", activeWs: "w-1", nowMs: NOW,
    consumeState: async (h) => { if (used.has(h)) return false; used.add(h); return true; }, ...over,
  };
}

describe("oauth callback checks", () => {
  it("accepts a valid callback exactly once", async () => {
    const used = new Set<string>();
    const first = await checkCallback(input({}, used));
    expect(first).toMatchObject({ ok: true, code: "abc" });
    expect(used.has(stateHash("state-1234"))).toBe(true);
    expect(await checkCallback(input({}, used))).toEqual({ ok: false, reason: "state_replayed" });
  });
  it("rejects every tampering and mismatch", async () => {
    const t = signCookie(COOKIE, SECRET);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...COOKIE, uid: "u-9" })).toString("base64url");
    const cases: [string, Partial<CallbackInput>, string][] = [
      ["vendor error", { query: { error: "access_denied" } }, "denied"],
      ["no code", { query: { state: "state-1234" } }, "missing_code"],
      ["no cookie", { cookieToken: undefined }, "cookie_missing"],
      ["forged cookie", { cookieToken: `${forged}.${sig}` }, "cookie_invalid"],
      ["truncated signature", { cookieToken: `${body}.${sig.slice(2)}` }, "cookie_invalid"],
      ["expired", { nowMs: NOW + 700_000 }, "expired"],
      ["state differs", { query: { code: "abc", state: "state-9999" } }, "state_mismatch"],
      ["other connector", { connector: "slack" }, "wrong_connector"],
      ["other user", { uid: "u-2" }, "wrong_user"],
      ["other workspace", { activeWs: "w-2" }, "wrong_workspace"],
    ];
    for (const [name, over, reason] of cases) expect(await checkCallback(input(over)), name).toEqual({ ok: false, reason });
  });
  it("does not consume the one-time state when an earlier check fails", async () => {
    const used = new Set<string>();
    await checkCallback(input({ uid: "u-2" }, used));
    expect(used.size).toBe(0);
  });
});
