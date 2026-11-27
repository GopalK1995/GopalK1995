import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { rpcMissing, suppressionAdd, suppressionCheck, suppressionDisplay } from "../suppression-db";

type Call = { fn: string; a: Record<string, unknown> };
const fakeDb = (reply: (fn: string) => { data: unknown; error: { code?: string } | null }, calls: Call[] = []): Db =>
  ({ rpc: (fn: string, a: Record<string, unknown>) => { calls.push({ fn, a }); return Promise.resolve(reply(fn)); } }) as unknown as Db;
const never = async (): Promise<boolean> => { throw new Error("legacy path must not run"); };

describe("suppression RPCs (AUD-034)", () => {
  it("checks through the RPC with the normalised address and never the legacy path", async () => {
    const calls: Call[] = [];
    const hit = await suppressionCheck(fakeDb(() => ({ data: true, error: null }), calls), "ws1", "  Bob@X.test ", never);
    expect(hit).toBe(true);
    expect(calls).toEqual([{ fn: "suppression_check", a: { p_workspace: "ws1", p_email: "bob@x.test" } }]);
  });
  it("falls back to the legacy lookup only when the function is missing (migration not applied)", async () => {
    for (const code of ["PGRST202", "42883"]) {
      expect(await suppressionCheck(fakeDb(() => ({ data: null, error: { code } })), "ws1", "a@b.test", async () => true)).toBe(true);
      expect(await suppressionAdd(fakeDb(() => ({ data: null, error: { code } })), { workspaceId: "ws1", email: "a@b.test", reason: "unsubscribe", source: "t" }, async () => true)).toBe(true);
    }
    expect(rpcMissing({ code: "55000" })).toBe(false);
  });
  it("fails closed on any other error: no fallback, no echo of the address", async () => {
    const db = fakeDb(() => ({ data: null, error: { code: "55000" } }));
    await expect(suppressionCheck(db, "ws1", "secret@x.test", never)).rejects.toThrow(/suppression check failed/);
    await expect(suppressionAdd(db, { workspaceId: "ws1", email: "secret@x.test", reason: "manual", source: "t" }, never)).rejects.toThrow(/insert failed/);
    await expect(suppressionCheck(db, "ws1", "secret@x.test", never)).rejects.not.toThrow(/secret@x\.test/);
  });
  it("add sends the reason, source and lead and returns the database answer", async () => {
    const calls: Call[] = [];
    const added = await suppressionAdd(fakeDb(() => ({ data: false, error: null }), calls), { workspaceId: "ws1", email: "A@B.test", reason: "complaint", source: "resend", leadId: "l1" }, never);
    expect(added).toBe(false);
    expect(calls[0].a).toEqual({ p_workspace: "ws1", p_email: "a@b.test", p_reason: "complaint", p_source: "resend", p_lead: "l1" });
  });
  it("never sends a pepper or hash computed client side", async () => {
    const calls: Call[] = [];
    await suppressionCheck(fakeDb(() => ({ data: false, error: null }), calls), "ws1", "a@b.test", never);
    expect(Object.keys(calls[0].a).sort()).toEqual(["p_email", "p_workspace"]);
  });
  it("display: shows a legacy address (masked without pii.read), otherwise only a hash fingerprint", () => {
    const mask = (e: string) => `m(${e})`;
    expect(suppressionDisplay("a@b.test", null, mask, true)).toBe("a@b.test");
    expect(suppressionDisplay("a@b.test", null, mask, false)).toBe("m(a@b.test)");
    const d = suppressionDisplay(null, "h2:" + "ab".repeat(32), mask, true);
    expect(d).toContain("abababab");
    expect(d).not.toContain("@");
  });
});
