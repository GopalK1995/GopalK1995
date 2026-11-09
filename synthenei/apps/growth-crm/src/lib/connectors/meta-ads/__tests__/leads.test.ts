// Leadgen mapper, consent, attribution, dedupe and tenant isolation.
import { beforeEach, describe, expect, it } from "vitest";
import { CredentialError, type FieldMapSpec } from "../../core/types";
import * as F from "../__fixtures__/payloads";
import { consentGrants, consentRulesOf, handleLeadgen, mapLead, sha256Hex } from "../leads";
import { parseGraphLead } from "../graph";
import { makeMockGateway, type MockGateway } from "../mock";
import { parseWebhook, type LeadgenEvent } from "../payload";
import { CONN, fakeDeps } from "./fake-store";

const SECRETS = { access_token: "t", page_id: F.PAGE };
const EVT = parseWebhook(F.leadgenBody())[0] as LeadgenEvent;
let deps: ReturnType<typeof fakeDeps>, gw: MockGateway, rejects: string[];
const run = (evt = EVT, secrets: Record<string, string> = SECRETS, conn = CONN) => handleLeadgen({ deps, conn, secrets, gateway: gw, reject: (r) => rejects.push(r) }, evt);
beforeEach(() => { deps = fakeDeps(); gw = makeMockGateway(); rejects = []; gw.seedLead(parseGraphLead(F.graphLead())!); });

describe("mapper", () => {
  const lead = parseGraphLead(F.graphLead())!;
  it("maps standard questions with transforms (lower email, E.164 phone)", () => {
    expect(mapLead(lead, []).row).toEqual({ full_name: "Asha Rao", email: "asha@example.com", phone: "+919876543210", city: "Chennai" });
  });
  it("a tenant row replaces the default and can map a custom question", () => {
    const tenant: FieldMapSpec[] = [{ externalObject: "Lead", externalField: "city", localTable: "leads", localColumn: "district", direction: "in" }, { externalObject: "Lead", externalField: "budget", localTable: "leads", localColumn: "practice_area", direction: "in" }];
    const l = parseGraphLead(F.graphLead({ field_data: [{ name: "email", values: ["a@b.co"] }, { name: "city", values: ["X"] }, { name: "budget", values: ["High"] }] }))!;
    expect(mapLead(l, tenant).row).toEqual({ email: "a@b.co", district: "X", practice_area: "High" });
  });
  it("composes the name from first and last, and reports a bad phone instead of storing it", () => {
    const l = parseGraphLead(F.graphLead({ field_data: [{ name: "first_name", values: ["A"] }, { name: "last_name", values: ["B"] }, { name: "phone_number", values: ["12"] }] }))!;
    const m = mapLead(l, []);
    expect(m.row.full_name).toBe("A B");
    expect(m.row.phone).toBeUndefined();
    expect(m.rejected).toEqual(["transform_failed:phone_number"]);
  });
});

describe("consent from the form", () => {
  it("never grants by default, grants on a yes answer or a ticked checkbox", () => {
    expect(consentGrants(parseGraphLead(F.graphLead({ field_data: [{ name: "email", values: ["a@b.co"] }] }))!, consentRulesOf({}))).toEqual([]);
    expect(consentGrants(parseGraphLead(F.graphLead())!, consentRulesOf({}))).toEqual(["whatsapp"]);
    const l = parseGraphLead(F.graphLead({ custom_disclaimer_responses: [{ checkbox_key: "mk", is_checked: true }, { checkbox_key: "no", is_checked: false }] }))!;
    expect(consentGrants(l, consentRulesOf({ consent_rules: [{ source: "checkbox", key: "mk", purpose: "marketing_email" }, { source: "checkbox", key: "no", purpose: "demo_followup" }, { source: "checkbox", key: "x", purpose: "bogus" }] }))).toEqual(["marketing_email", "whatsapp"]);
  });
});

describe("handleLeadgen", () => {
  it("creates a lead with source, campaign attribution and the form consent", async () => {
    expect(await run()).toBe("created");
    const lead = deps.store.leads[0];
    expect(lead).toMatchObject({ source: "meta", first_touch_channel: "meta", first_touch_campaign: "Camp one", workspace_id: "w-1", tenant_id: "t-1", email: "asha@example.com", phone: "+919876543210" });
    expect(lead.utm).toEqual({ source: "facebook", medium: "paid_social", campaign: "Camp one", content: "Ad one", term: "Set one" });
    expect(lead.campaign_id).toBe(deps.store.campaigns[0].id);
    expect(deps.store.consent).toMatchObject([{ purpose: "whatsapp", noticeVersion: `meta-lead-form:${F.FORM}`, subjectRef: sha256Hex("asha@example.com") }]);
    expect(deps.store.events.map((e) => e.type)).toEqual(["consent.changed"]);
  });
  it("is idempotent: a redelivery creates nothing and writes no second consent row", async () => {
    await run();
    expect(await run()).toBe("duplicate");
    expect(deps.store.leads).toHaveLength(1);
    expect(deps.store.consent).toHaveLength(1);
  });
  it("dedupes against an existing person and keeps their first touch", async () => {
    deps.store.leads.push({ id: "old", workspace_id: "w-1", phone: "+919876543210", source: "csv", first_touch_channel: "email" });
    expect(await run()).toBe("matched");
    expect(deps.store.leads).toHaveLength(1);
    expect(deps.store.leads[0]).toMatchObject({ source: "csv", first_touch_channel: "email", last_touch_channel: "meta", last_touch_campaign: "Camp one" });
  });
  it("a person in another workspace is not matched", async () => {
    deps.store.leads.push({ id: "other", workspace_id: "w-2", phone: "+919876543210" });
    expect(await run()).toBe("created");
    expect(deps.store.leads).toHaveLength(2);
  });
  it("refuses a page this connection did not select", async () => {
    expect(await run(EVT, { ...SECRETS, page_id: "999" })).toBe("rejected");
    expect(rejects).toEqual(["page_mismatch"]);
    expect(deps.store.leads).toHaveLength(0);
  });
  it("rejects a lead with neither email nor valid phone, and a lead Meta no longer has", async () => {
    gw.seedLead(parseGraphLead(F.graphLead({ field_data: [{ name: "full_name", values: ["Only Name"] }] }))!);
    expect(await run()).toBe("rejected");
    expect(rejects).toContain("no_contact");
    const g2 = { ...gw, getLead: async () => null } as MockGateway;
    rejects = [];
    expect(await handleLeadgen({ deps, conn: CONN, secrets: SECRETS, gateway: g2, reject: (r) => rejects.push(r) }, EVT)).toBe("rejected");
    expect(rejects).toEqual(["lead_unavailable"]);
  });
  it("a dead token surfaces as a CredentialError (connection needs attention)", async () => {
    const g2 = { ...gw, getLead: async () => { throw new CredentialError("x"); } } as MockGateway;
    await expect(handleLeadgen({ deps, conn: CONN, secrets: SECRETS, gateway: g2, reject: () => {} }, EVT)).rejects.toBeInstanceOf(CredentialError);
  });
  it("sandbox campaigns are marked synthetic", async () => { await run(); expect(deps.store.campaigns[0].synthetic).toBe(true); });
});
