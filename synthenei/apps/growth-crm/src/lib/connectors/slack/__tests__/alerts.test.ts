// Alert catalogue, privacy defaults and message content.
import { describe, expect, it } from "vitest";
import en from "../../../../../messages/en/slack.json";
import ta from "../../../../../messages/ta/slack.json";
import { ALERT_EVENT_TYPES, ALERT_KEYS, alertForEvent, buildAlert, crmUrl, formatAmount, parseAlerts, serializeAlerts, settingsOf, t } from "../alerts";
import { EVENT_TYPES as LEAD } from "../../../events/catalog/lead";
import { EVENT_TYPES as PAYMENT } from "../../../events/catalog/payment";
import { EVENT_TYPES as CONNECTOR } from "../../../events/catalog/connector";

const BASE = "https://crm.example.test";
const lead = { type: "lead.created", objectType: "lead", objectId: "L1", data: {} };
const text = (m: unknown) => JSON.stringify(m);

describe("event to alert mapping", () => {
  it("maps the four alert types and nothing else", () => {
    expect(alertForEvent("lead.created")).toBe("new_enquiry");
    expect(alertForEvent("lead.sla_breached")).toBe("sla_breached");
    expect(alertForEvent("payment.paid")).toBe("advance_received");
    expect(alertForEvent("connector.sync.failed")).toBe("sync_failed");
    for (const other of ["lead.updated", "payment.failed", "connector.sync.completed", "deal.won", "", "lead.*"]) expect(alertForEvent(other)).toBeNull();
  });
  it("the existing event types it relies on are in the catalogue", () => {
    const known = new Set<string>([...LEAD, ...PAYMENT, ...CONNECTOR].map((e) => e.type));
    for (const e of ALERT_EVENT_TYPES) if (e !== "lead.sla_breached") expect(known.has(e), e).toBe(true);
  });
  it("alert switches round-trip; absent means all on, empty means none, junk is ignored", () => {
    expect(parseAlerts(undefined)).toEqual([...ALERT_KEYS]);
    expect(parseAlerts("")).toEqual([]);
    expect(parseAlerts("new_enquiry, bogus,sync_failed")).toEqual(["new_enquiry", "sync_failed"]);
    expect(serializeAlerts(["sync_failed", "new_enquiry", "x"])).toBe("new_enquiry,sync_failed");
    expect(settingsOf({ channel_id: "C1", include_names: "1", locale: "ta" })).toMatchObject({ channelId: "C1", includeNames: true, locale: "ta" });
    expect(settingsOf({})).toMatchObject({ channelId: null, includeNames: false, locale: "en" });
  });
});

describe("message content", () => {
  it("new enquiry shows source and city with a lead link, and no name by default", () => {
    const m = buildAlert({ key: "new_enquiry", event: lead, subject: { name: "Asha Rao", source: "website", city: "Madurai", link: { type: "lead", id: "L1" } }, settings: { includeNames: false, locale: "en" }, baseUrl: BASE });
    expect(m.text).toBe("New enquiry");
    expect(text(m)).not.toContain("Asha");
    expect(text(m)).toContain("website");
    expect(text(m)).toContain("Madurai");
    expect(text(m)).toContain(`${BASE}/leads/L1`);
  });
  it("shows the name only when the owner opted in", () => {
    const m = buildAlert({ key: "new_enquiry", event: lead, subject: { name: "Asha Rao", source: "website" }, settings: { includeNames: true, locale: "en" }, baseUrl: BASE });
    expect(m.text).toBe("New enquiry: Asha Rao");
  });
  it("a hostile name cannot ping the channel", () => {
    const m = buildAlert({ key: "new_enquiry", event: lead, subject: { name: "<!channel> Bob", source: "<!here>" }, settings: { includeNames: true, locale: "en" }, baseUrl: BASE });
    expect(text(m)).not.toMatch(/<!(channel|here)>/);
    expect(m.text).not.toMatch(/[<>]/);
  });
  it("SLA breach and advance received", () => {
    const sla = buildAlert({ key: "sla_breached", event: { ...lead, type: "lead.sla_breached" }, subject: { source: "meta", status: "new" }, settings: { includeNames: false, locale: "en" }, baseUrl: BASE });
    expect(sla.text).toBe("SLA breached: first response overdue");
    const adv = buildAlert({ key: "advance_received", event: { type: "payment.paid", objectType: "payment", objectId: "P1", data: {} }, subject: { amountPaise: 2_500_000, currency: "INR", link: { type: "deal", id: "D1" } }, settings: { includeNames: false, locale: "en" }, baseUrl: BASE });
    expect(adv.text).toMatch(/^Advance received: /);
    expect(adv.text).toContain("25,000");
    expect(text(adv)).toContain(`${BASE}/pipeline?deal=D1`);
  });
  it("sync failed names the connector, stream and reason from the event and links to integrations", () => {
    const m = buildAlert({ key: "sync_failed", event: { type: "connector.sync.failed", objectType: "integration", objectId: "I1", data: { connector: "meta-ads", stream: "insights", reason: "token_refresh_failed" } }, subject: null, settings: { includeNames: false, locale: "en" }, baseUrl: BASE });
    expect(m.text).toBe("Sync failed: meta-ads");
    expect(text(m)).toContain("token refresh failed");
    expect(text(m)).toContain(`${BASE}/integrations`);
  });
  it("no deployment base url (or a non-https one) means no button, never a guessed address", () => {
    for (const base of [undefined, "", "http://crm.example.test"]) expect(text(buildAlert({ key: "new_enquiry", event: lead, subject: null, settings: { includeNames: false, locale: "en" }, baseUrl: base }))).not.toContain("actions");
    expect(crmUrl(`${BASE}///`, "/x")).toBe(`${BASE}/x`);
  });
  it("Tamil alerts use the Tamil dictionary and fall back to English per key", () => {
    expect(buildAlert({ key: "new_enquiry", event: lead, subject: null, settings: { includeNames: false, locale: "ta" }, baseUrl: BASE }).text).toBe(ta.alert.new_enquiry);
    expect(t("ta", "no.such.key")).toBe("no.such.key");
  });
  it("amounts format per currency and fall back safely", () => {
    expect(formatAmount(150_000, "INR", "en")).toContain("1,500");
    expect(formatAmount(1050, "USD", "en")).toContain("10.50");
    expect(formatAmount(1000, "??", "en")).toBe("?? 10.00");
  });
});

describe("message files", () => {
  const keys = (o: unknown, p = ""): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (k.startsWith("_") ? [] : typeof v === "object" && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  it("Tamil has exactly the English keys and the same placeholders", () => {
    expect(keys(ta).sort()).toEqual(keys(en).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    expect(ph(ta.alert.new_enquiry_named)).toBe(ph(en.alert.new_enquiry_named));
    expect(ph(ta.alert.sync_failed)).toBe(ph(en.alert.sync_failed));
    expect(ph(ta.alert.advance_received_amount)).toBe(ph(en.alert.advance_received_amount));
  });
});
