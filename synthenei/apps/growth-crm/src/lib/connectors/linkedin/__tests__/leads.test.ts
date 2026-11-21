// Lead Gen Forms: response parsing (fixture shapes), mapping, consent, create / match / idempotency / tenant isolation, resumable poll.
import { beforeEach, describe, expect, it } from "vitest";
import { CredentialError } from "../../core/types";
import * as F from "../__fixtures__/payloads";
import { consentGrants, consentRulesOf, fieldsOf, handleLeadResponse, leadsStep, mapLead, type LeadCtx } from "../leads";
import { makeMockGateway, type MockGateway } from "../mock";
import { parseFormQuestions, parseLeadResponse } from "../rest";
import { CONN, fakeDeps } from "./fake-store";

describe("parseLeadResponse / parseFormQuestions (recorded shapes)", () => {
  it("reads answers, consents, owner, form and campaign", () => {
    const r = parseLeadResponse(F.rawLeadResponse());
    expect(r).toMatchObject({ id: "resp-0001", submittedAt: F.T0, ownerAccountUrn: F.ACCOUNT_URN, formUrn: F.FORM_URN, campaignUrn: "urn:li:sponsoredCampaign:200000001", testLead: false, consents: [{ id: "7001", accepted: true }] });
    expect(r?.answers).toEqual(expect.arrayContaining([{ questionId: "11", value: "Asha" }, { questionId: "16", value: "yes" }]));
  });
  it("returns null for junk instead of throwing", () => {
    for (const bad of [null, "x", {}, { id: "a" }, { id: "a", submittedAt: "nope" }, { submittedAt: 5 }]) expect(parseLeadResponse(bad)).toBeNull();
  });
  it("drops empty answers and keeps test leads flagged", () => {
    const r = parseLeadResponse(F.rawLeadResponse({ testLead: true, formResponse: { answers: [{ questionId: 1, answerDetails: { textQuestionAnswer: { answer: "  " } } }] } }));
    expect(r?.answers).toEqual([]);
    expect(r?.testLead).toBe(true);
  });
  it("form definition: predefined fields lower-cased, custom questions by id", () => {
    expect(parseFormQuestions(F.rawForm)).toEqual(F.QUESTIONS);
    expect(parseFormQuestions(null).size).toBe(0);
  });
});

describe("mapping and consent", () => {
  it("full name is composed, email lower-cased, phone to E.164, company to firm_name", () => {
    const f = fieldsOf(F.leadResponse(), F.QUESTIONS);
    expect(f.full_name).toBe("Asha Rao");
    expect(mapLead(f, []).row).toMatchObject({ full_name: "Asha Rao", email: "asha.rao@example.invalid", phone: "+919845000001", firm_name: "Rao and Co" });
  });
  it("a tenant map row replaces the default for a column", () => {
    const row = mapLead({ email: "a@example.invalid", custom_16: "Tax" }, [{ externalObject: "LeadFormResponse", externalField: "custom_16", localTable: "leads", localColumn: "practice_area", direction: "in", transform: "trim" }]).row;
    expect(row).toMatchObject({ email: "a@example.invalid", practice_area: "Tax" });
  });
  it("no rules, no consent; field and checkbox rules grant only on yes / accepted", () => {
    const r = F.leadResponse({ answers: [...F.leadResponse().answers, { questionId: "16", value: "yes" }] }), f = fieldsOf(r, new Map([...F.QUESTIONS, ["16", "wants_demo"]]));
    expect(consentGrants(r, f, consentRulesOf({}))).toEqual([]);
    const rules = consentRulesOf({ consent_rules: [{ source: "checkbox", key: "7001", purpose: "marketing_email" }, { source: "field", key: "wants_demo", purpose: "demo_followup" }, { source: "field", key: "x", purpose: "bogus" }, "junk"] });
    expect(rules).toHaveLength(2);
    expect(consentGrants(r, f, rules).sort()).toEqual(["demo_followup", "marketing_email"]);
    expect(consentGrants(F.leadResponse({ consents: [{ id: "7001", accepted: false }] }), {}, rules)).toEqual([]);
  });
});

let deps: ReturnType<typeof fakeDeps>, gw: MockGateway;
const SECRETS = { access_token: "t", ad_account_id: F.ACCOUNT };
const ctx = (over: Partial<LeadCtx> = {}, rejects: string[] = []): LeadCtx => ({ deps, conn: CONN, secrets: SECRETS, gateway: gw, reject: (r) => rejects.push(r), ...over });
beforeEach(() => { deps = fakeDeps(); gw = makeMockGateway(); });

describe("handleLeadResponse", () => {
  it("creates a lead with linkedin attribution, the campaign link and external ids", async () => {
    expect(await handleLeadResponse(ctx(), F.leadResponse(), F.QUESTIONS)).toBe("created");
    expect(deps.store.leads[0]).toMatchObject({
      source: "linkedin", first_touch_channel: "linkedin", last_touch_channel: "linkedin", full_name: "Asha Rao", tenant_id: "t-1", workspace_id: "w-1",
      utm: { source: "linkedin", medium: "paid_social" }, external_ids: { linkedin_response_id: "resp-0001" },
    });
    expect(deps.store.campaigns).toHaveLength(1);
    expect(deps.store.leads[0].campaign_id).toBe(deps.store.campaigns[0].id);
  });
  it("is idempotent by response id", async () => {
    await handleLeadResponse(ctx(), F.leadResponse(), F.QUESTIONS);
    expect(await handleLeadResponse(ctx(), F.leadResponse(), F.QUESTIONS)).toBe("duplicate");
    expect(deps.store.leads).toHaveLength(1);
  });
  it("matches an existing person by phone or email: first touch kept, only last touch moves", async () => {
    deps.store.leads.push({ id: "old", workspace_id: "w-1", email: "asha.rao@example.invalid", source: "landing", first_touch_channel: "organic", last_touch_channel: "organic" });
    expect(await handleLeadResponse(ctx(), F.leadResponse(), F.QUESTIONS)).toBe("matched");
    expect(deps.store.leads).toHaveLength(1);
    expect(deps.store.leads[0]).toMatchObject({ source: "landing", first_touch_channel: "organic", last_touch_channel: "linkedin" });
  });
  it("TENANT ISOLATION: a response owned by another ad account is rejected and writes nothing", async () => {
    const rej: string[] = [];
    expect(await handleLeadResponse(ctx({}, rej), F.leadResponse({ ownerAccountUrn: "urn:li:sponsoredAccount:999" }), F.QUESTIONS)).toBe("rejected");
    expect(await handleLeadResponse(ctx({}, rej), F.leadResponse({ ownerAccountUrn: null }), F.QUESTIONS)).toBe("rejected");
    expect(await handleLeadResponse(ctx({ secrets: { access_token: "t" } }, rej), F.leadResponse(), F.QUESTIONS)).toBe("rejected");
    expect(rej).toEqual(["account_mismatch", "account_mismatch", "account_mismatch"]);
    expect(deps.store.leads).toHaveLength(0);
    expect(deps.store.campaigns).toHaveLength(0);
  });
  it("rejects a response with neither phone nor email", async () => {
    const rej: string[] = [];
    expect(await handleLeadResponse(ctx({}, rej), F.leadResponse({ answers: [{ questionId: "11", value: "Asha" }] }), F.QUESTIONS)).toBe("rejected");
    expect(rej).toContain("no_contact");
  });
  it("writes consent once per response, only for matching rules, with consent.changed", async () => {
    const conn = { ...CONN, settings: { consent_rules: [{ source: "checkbox", key: "7001", purpose: "marketing_email" }] } };
    await handleLeadResponse(ctx({ conn }), F.leadResponse(), F.QUESTIONS);
    expect(deps.store.consent).toHaveLength(1);
    expect(deps.store.consent[0]).toMatchObject({ purpose: "marketing_email", noticeVersion: "linkedin-lead-form:555000" });
    expect(deps.store.events.map((e) => e.type)).toEqual(["consent.changed"]);
    expect(JSON.stringify(deps.store.consent)).not.toContain("example.invalid");   // only a hash of the contact is stored as the subject
    await handleLeadResponse(ctx({ conn }), F.leadResponse(), F.QUESTIONS);
    expect(deps.store.consent).toHaveLength(1);
  });
  it("no consent rule means no consent row", async () => {
    await handleLeadResponse(ctx(), F.leadResponse(), F.QUESTIONS);
    expect(deps.store.consent).toHaveLength(0);
  });
  it("a test lead is kept but flagged", async () => {
    await handleLeadResponse(ctx(), F.leadResponse({ testLead: true }), F.QUESTIONS);
    expect((deps.store.leads[0].external_ids as Record<string, unknown>).linkedin_test_lead).toBe(true);
  });
});

describe("leadsStep (poll)", () => {
  const seed = (n: number, t0 = F.T0) => gw.seedLeads(Array.from({ length: n }, (_, i) => F.leadResponse({ id: `r-${i}`, submittedAt: t0 + i * 1000, answers: [{ questionId: "13", value: `p${i}@example.invalid` }] })), { "13": "email" });
  it("first run backfills 30 days, loads leads and moves the cursor to the newest submission", async () => {
    seed(3);
    const r = await leadsStep(ctx(), undefined);
    expect(r).toMatchObject({ done: true, rowsIn: 3, rowsRejected: 0, cursor: { since: F.T0 + 2000 } });
    expect(deps.store.leads).toHaveLength(3);
  });
  it("re-running overlaps by the newest timestamp and writes nothing twice", async () => {
    seed(3);
    const first = await leadsStep(ctx(), undefined);
    const again = await leadsStep(ctx(), first.cursor);
    expect(again.rowsIn).toBe(0);
    expect(deps.store.leads).toHaveLength(3);
  });
  it("without a selected ad account it does nothing", async () => {
    expect(await leadsStep(ctx({ secrets: { access_token: "t" } }), undefined)).toMatchObject({ done: true, rowsIn: 0, sample: { skipped: "no_ad_account" } });
  });
  it("paginates with a resumable cursor", async () => {
    const calls: number[] = [];
    const g = { ...gw, listLeadResponses: async (i: { start: number }) => { calls.push(i.start); return i.start === 0 ? { rows: [F.leadResponse({ id: "a", submittedAt: F.T0 })], nextStart: 1 } : { rows: [F.leadResponse({ id: "b", submittedAt: F.T0 + 5, answers: [{ questionId: "13", value: "b@example.invalid" }] })] }; } } as unknown as MockGateway;
    const first = await leadsStep(ctx({ gateway: g }), undefined);
    expect(first).toMatchObject({ done: false, cursor: { start: 1, maxSeen: F.T0 } });
    const second = await leadsStep(ctx({ gateway: g }), first.cursor);
    expect(second).toMatchObject({ done: true, cursor: { since: F.T0 + 5 } });
    expect(calls).toEqual([0, 1]);
  });
  it("a dead token or missing product surfaces as CredentialError (needs_attention), not as an empty success", async () => {
    const g = { ...gw, listLeadResponses: async () => { throw new CredentialError("LinkedIn rejected the access token"); } } as unknown as MockGateway;
    await expect(leadsStep(ctx({ gateway: g }), undefined)).rejects.toBeInstanceOf(CredentialError);
  });
  it("counts rows from another account as rejected and keeps going", async () => {
    gw.seedLeads([F.leadResponse({ id: "x", ownerAccountUrn: "urn:li:sponsoredAccount:9" }), F.leadResponse({ id: "y", submittedAt: F.T0 + 1 })], Object.fromEntries(F.QUESTIONS));
    const rej: string[] = [];
    const r = await leadsStep(ctx({}, rej), undefined);
    expect(r).toMatchObject({ rowsIn: 1, rowsRejected: 1 });
    expect(rej).toEqual(["account_mismatch"]);
  });
});
