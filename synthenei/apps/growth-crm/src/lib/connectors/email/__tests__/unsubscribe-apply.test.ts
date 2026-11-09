// The unsubscribe link and the one-click endpoint share this function: token -> consent withdrawal + suppression, idempotent, no writes on preview.
import { describe, expect, it } from "vitest";
import { applyUnsubscribe, previewUnsubscribe } from "../unsubscribe-apply";
import { signUnsubscribe } from "../unsubscribe";
import { subjectRefOf } from "../withdraw";
import { FakeStore, SECRET } from "./fake";

const NOW = 1_800_000_000_000;
const tok = (over = {}, at = NOW) => signUnsubscribe({ t: "t1", w: "w1", c: "c1", l: "l1", s: null, ...over }, SECRET, at);
function setup() { const s = new FakeStore(); s.addLead("l1", "w1", "Asha@Example.com"); s.addLead("l2", "w1", "other@example.com"); return s; }

describe("unsubscribe", () => {
  it("writes a withdrawn consent row (marketing_email) and a suppression, so can_contact turns false for that lead only", async () => {
    const s = setup();
    expect(await s.canContact("l1")).toBe(true);
    expect(await applyUnsubscribe(s, tok(), SECRET, NOW + 1000)).toEqual({ status: "done" });
    expect(await s.canContact("l1")).toBe(false);
    expect(await s.canContact("l2")).toBe(true);
    expect(s.consent.at(-1)).toMatchObject({ action: "withdrawn", leadId: "l1", subjectRef: subjectRefOf("asha@example.com"), tenantId: "t1", workspaceId: "w1" });
    expect(s.suppressed).toEqual([expect.objectContaining({ email: "asha@example.com", reason: "unsubscribe", source: "unsubscribe_link", workspaceId: "w1" })]);
    expect(s.events.map((e) => e.type)).toContain("email.unsubscribed");
    expect(s.audits).toContain("email.unsubscribe");
  });
  it("hashes the address in the consent log: the raw address is never stored there", async () => {
    const s = setup();
    await applyUnsubscribe(s, tok(), SECRET, NOW);
    expect(JSON.stringify(s.consent)).not.toMatch(/example\.com/);
    expect(JSON.stringify(s.events)).not.toMatch(/example\.com/);
  });
  it("is idempotent: a second click adds no consent or suppression rows", async () => {
    const s = setup();
    await applyUnsubscribe(s, tok(), SECRET, NOW); await applyUnsubscribe(s, tok(), SECRET, NOW);
    expect(s.consent.filter((c) => c.action === "withdrawn")).toHaveLength(1);
    expect(s.suppressed).toHaveLength(1);
  });
  it("rejects an expired, forged or foreign-secret token and changes nothing", async () => {
    const s = setup();
    expect(await applyUnsubscribe(s, tok(), SECRET, NOW + 200 * 86_400_000)).toEqual({ status: "expired" });
    expect(await applyUnsubscribe(s, tok(), "other-secret", NOW)).toEqual({ status: "invalid" });
    expect(await applyUnsubscribe(s, `${tok().slice(0, -3)}abc`, SECRET, NOW)).toEqual({ status: "invalid" });
    expect(await applyUnsubscribe(s, "", SECRET, NOW)).toEqual({ status: "invalid" });
    expect(s.consent.filter((c) => c.action === "withdrawn")).toHaveLength(0);
    expect(s.suppressed).toHaveLength(0);
  });
  it("a token for a lead in another workspace cannot withdraw this workspace's lead", async () => {
    const s = setup();
    expect(await applyUnsubscribe(s, tok({ w: "w9" }), SECRET, NOW)).toEqual({ status: "done" });   // lead not found in w9: nothing to change
    expect(await s.canContact("l1")).toBe(true);
    expect(s.suppressed).toHaveLength(0);
  });
  it("a lead with no address left still gets the withdrawal recorded against the lead", async () => {
    const s = new FakeStore(); s.addLead("l1", "w1", null);
    await applyUnsubscribe(s, tok(), SECRET, NOW);
    expect(await s.canContact("l1")).toBe(false);
    await applyUnsubscribe(s, tok(), SECRET, NOW);
    expect(s.consent.filter((c) => c.action === "withdrawn")).toHaveLength(1);
  });
  it("preview never writes (mail scanners fetch links)", () => {
    expect(previewUnsubscribe(tok(), SECRET, NOW)).toMatchObject({ status: "ready" });
    expect(previewUnsubscribe(tok(), SECRET, NOW + 200 * 86_400_000)).toEqual({ status: "expired" });
    expect(previewUnsubscribe("junk", SECRET, NOW)).toEqual({ status: "invalid" });
  });
});
