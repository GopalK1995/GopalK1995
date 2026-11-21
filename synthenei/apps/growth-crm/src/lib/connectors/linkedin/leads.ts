// Lead Gen Forms: poll lead form responses of the connection's own ad account -> map answers through the tenant's field map -> create or
// match a lead with source/campaign attribution and the consent the form captured. Idempotent: the response id is an external link, so a
// re-read (the cursor overlaps by one timestamp) is recognised and skipped before anything is written. A person who already exists
// (same E.164 phone or lower email) keeps their first-touch attribution; only last-touch moves. (Lead Sync webhooks, when LinkedIn approves
// them, can feed handleLeadResponse directly: the logic does not care whether a response arrived by poll or push.)
import { createHash } from "node:crypto";
import { applyFieldMap, effectiveMap } from "../core/field-map";
import { contentHash } from "../core/upserter";
import type { ConnectionRow, ConnectionSecrets, FieldMapSpec, SyncResult } from "../core/types";
import { ACCOUNT_URN_PREFIX, CAMPAIGN_URN_PREFIX, CRED, FORM_CONSENT_PURPOSES, LEADS_BACKFILL_DAYS, LEADS_PAGE_SIZE, LEAD_OBJECT, type FormConsentPurpose } from "./constants";
import type { LeadResponse, LinkedInGateway } from "./gateway";
import type { ConnScope, LinkedInDeps } from "./store";

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
export const scopeOf = (c: ConnectionRow): ConnScope => ({ tenantId: c.tenantId, workspaceId: c.workspaceId, connectionId: c.id });
export const accountUrnOf = (secrets: ConnectionSecrets): string | null => { const id = secrets[CRED.adAccountId]; return id ? `${ACCOUNT_URN_PREFIX}${id}` : null; };
const idOf = (urn: string | null): string | null => { const m = urn ? /(\d+)$/.exec(urn) : null; return m ? m[1] : null; };
const formIdOf = (urn: string | null): string | null => { const m = urn ? /leadGenForm:(\d+)/.exec(urn) : null; return m ? m[1] : null; };

/** LinkedIn's predefined question names (lower-cased by the gateway). The tenant's field-mapping editor adds or replaces rows. */
export const DEFAULT_LEAD_MAP: FieldMapSpec[] = [
  { externalObject: LEAD_OBJECT, externalField: "full_name", localTable: "leads", localColumn: "full_name", direction: "in", transform: "trim" },
  { externalObject: LEAD_OBJECT, externalField: "email", localTable: "leads", localColumn: "email", direction: "in", transform: "lower_email" },
  { externalObject: LEAD_OBJECT, externalField: "phone_number", localTable: "leads", localColumn: "phone", direction: "in", transform: "e164_phone" },
  { externalObject: LEAD_OBJECT, externalField: "city", localTable: "leads", localColumn: "city", direction: "in", transform: "trim" },
  { externalObject: LEAD_OBJECT, externalField: "company_name", localTable: "leads", localColumn: "firm_name", direction: "in", transform: "trim" },
  { externalObject: LEAD_OBJECT, externalField: "job_title", localTable: "leads", localColumn: "role_title", direction: "in", transform: "trim" },
];

/** A consent rule: which form answer grants which purpose. `field` = a question answered yes (field key), `checkbox` = an accepted consent (consent id). */
export interface ConsentRule { source: "field" | "checkbox"; key: string; purpose: FormConsentPurpose }
const PURPOSES = new Set<string>(FORM_CONSENT_PURPOSES);
/** Tenant rules from connection settings (`consent_rules`). There are no defaults: LinkedIn's question names are tenant-specific, so nothing is ever granted without a rule. */
export function consentRulesOf(settings: Record<string, unknown>): ConsentRule[] {
  const raw = Array.isArray(settings.consent_rules) ? settings.consent_rules : [];
  return raw.flatMap((r): ConsentRule[] => {
    const x = r as Record<string, unknown> | null;
    return x && (x.source === "field" || x.source === "checkbox") && typeof x.key === "string" && x.key && PURPOSES.has(String(x.purpose)) ? [{ source: x.source, key: x.key, purpose: x.purpose as FormConsentPurpose }] : [];
  });
}
const YES = /^(yes|y|true|1|on|checked|agree|agreed|i agree|accept|accepted|opt[ _-]?in)$/i;
export const isYes = (v: string | undefined): boolean => !!v && YES.test(v.trim());

/** Answers keyed by field name (questionId -> name through the form definition; unknown questions become custom_<id>). */
export function fieldsOf(r: LeadResponse, questions: Map<string, string>): Record<string, string> {
  const f: Record<string, string> = {};
  for (const a of r.answers) f[questions.get(a.questionId) ?? `custom_${a.questionId}`] = a.value;
  if (!f.full_name) { const n = [f.first_name, f.last_name].filter(Boolean).join(" ").trim(); if (n) f.full_name = n; }
  if (!f.email && f.work_email) f.email = f.work_email;
  return f;
}

/** Purposes this response grants. A missing answer or a declined consent grants nothing. */
export function consentGrants(r: LeadResponse, fields: Record<string, string>, rules: ConsentRule[]): FormConsentPurpose[] {
  const out = new Set<FormConsentPurpose>();
  for (const rule of rules) {
    const hit = rule.source === "field" ? isYes(fields[rule.key]) : r.consents.some((c) => c.id === rule.key && c.accepted);
    if (hit) out.add(rule.purpose);
  }
  return [...out];
}

export function mapLead(fields: Record<string, string>, tenantMap: FieldMapSpec[]): { row: Record<string, unknown>; rejected: string[] } {
  const m = applyFieldMap(effectiveMap(DEFAULT_LEAD_MAP, tenantMap), LEAD_OBJECT, fields);
  return { row: { ...(m.byTable.leads ?? {}) }, rejected: m.rejected.map((x) => `${x.reason}:${x.field}`) };
}

/** Attribution columns for a new lead. utm.* are the channel's own labels. */
export function attributionOf(r: LeadResponse, campaignId: string | null, campaignText: string | null): Record<string, unknown> {
  return {
    source: "linkedin", first_touch_channel: "linkedin", last_touch_channel: "linkedin", first_touch_campaign: campaignText, last_touch_campaign: campaignText,
    ...(campaignId ? { campaign_id: campaignId } : {}),
    utm: { source: "linkedin", medium: "paid_social", ...(campaignText ? { campaign: campaignText } : {}) },
    external_ids: { linkedin_response_id: r.id, ...(r.formUrn ? { linkedin_form: r.formUrn } : {}), ...(r.testLead ? { linkedin_test_lead: true } : {}) },
  };
}

export interface LeadCtx { deps: LinkedInDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: LinkedInGateway; reject: (reason: string) => void }
export type LeadOutcome = "created" | "matched" | "duplicate" | "rejected";

export async function handleLeadResponse(c: LeadCtx, r: LeadResponse, questions: Map<string, string>): Promise<LeadOutcome> {
  const { deps, conn } = c;
  const mine = accountUrnOf(c.secrets);
  // Tenant isolation: a response is processed only for the ad account this connection selected.
  if (!mine || r.ownerAccountUrn !== mine) { c.reject("account_mismatch"); return "rejected"; }
  if (await deps.core.getLink(conn.id, LEAD_OBJECT, r.id)) return "duplicate";

  const fields = fieldsOf(r, questions);
  const { row: mapped, rejected } = mapLead(fields, await deps.core.getFieldMap(conn.id));
  for (const x of rejected) c.reject(x);
  const email = typeof mapped.email === "string" ? mapped.email : null, phone = typeof mapped.phone === "string" ? mapped.phone : null;
  if (!email && !phone) { c.reject("no_contact"); return "rejected"; }

  let campaignId: string | null = null, campaignText: string | null = null;
  const campaignExt = idOf(r.campaignUrn && r.campaignUrn.startsWith(CAMPAIGN_URN_PREFIX) ? r.campaignUrn : null);
  if (campaignExt) {
    campaignText = `LinkedIn campaign ${campaignExt}`;
    try { campaignId = await deps.store.ensureCampaign({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, externalId: campaignExt, name: campaignText, placeholder: true, synthetic: c.gateway.kind === "mock" }); }
    catch { deps.log.warn("linkedin campaign not linked", { connection: conn.id }); }   // attribution text still stands without the link
  }

  const attribution = attributionOf(r, campaignId, campaignText);
  const at = new Date(r.submittedAt).toISOString();
  let leadId = await deps.core.findByMatchKey("leads", conn.workspaceId, { phone: phone ?? undefined, email: email ?? undefined });
  const created = leadId === null;
  if (leadId) {
    // Existing person: keep first touch and source, move last touch only.
    await deps.core.updateLocal("leads", leadId, { last_touch_channel: "linkedin", last_touch_campaign: campaignText, last_touch_at: at });
  } else {
    const name = (typeof mapped.full_name === "string" && mapped.full_name) || email || phone || "Lead";
    leadId = await deps.core.insertLocal("leads", { ...attribution, ...mapped, full_name: name, last_touch_at: at, tenant_id: conn.tenantId, workspace_id: conn.workspaceId });
  }
  await deps.core.putLink({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, connectionId: conn.id, externalObject: LEAD_OBJECT, externalId: r.id, localTable: "leads", localId: leadId, contentHash: contentHash({ id: r.id, answers: r.answers }), direction: "in" });

  const subject = sha256Hex(email ?? (phone as string));
  for (const purpose of consentGrants(r, fields, consentRulesOf(conn.settings))) {
    const wrote = await deps.store.recordConsentOnce({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, leadId, subjectRef: subject, purpose, noticeVersion: `linkedin-lead-form:${formIdOf(r.formUrn) ?? "unknown"}`, note: `linkedin lead form response ${r.id}` });
    if (wrote) await deps.store.emit({ type: "consent.changed", workspaceId: conn.workspaceId, objectType: "lead", objectId: leadId, data: { purpose, action: "granted", via: "integration" } });
  }
  return created ? "created" : "matched";
}

export interface LeadsCursor { since?: number; maxSeen?: number; start?: number }
const asCursor = (c: unknown): LeadsCursor => {
  const o = c && typeof c === "object" ? (c as LeadsCursor) : {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
  return { since: n(o.since), maxSeen: n(o.maxSeen), start: n(o.start) };
};

/** One page of the poll. Resumable: while a window has more pages the cursor keeps `since` and moves `start`; the cursor advances to the newest submission only when the window is drained. */
export async function leadsStep(c: LeadCtx, cursorIn: unknown): Promise<SyncResult> {
  const cur = asCursor(cursorIn), account = accountUrnOf(c.secrets);
  if (!account) return { cursor: cur, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_ad_account" } };
  const since = cur.since ?? c.deps.now().getTime() - LEADS_BACKFILL_DAYS * 86400e3, start = cur.start ?? 0;
  const page = await c.gateway.listLeadResponses({ accountUrn: account, sinceMs: since, start, count: LEADS_PAGE_SIZE });   // a dead token / missing product throws CredentialError: needs_attention
  let created = 0, matched = 0, rejected = 0, dup = 0, maxSeen = cur.maxSeen ?? since;
  const reject = (reason: string) => { rejected++; c.reject(reason); };
  for (const r of page.rows) {
    maxSeen = Math.max(maxSeen, r.submittedAt);
    const qs = r.formUrn ? await c.gateway.formQuestions(r.formUrn) : new Map<string, string>();
    const out = await handleLeadResponse({ ...c, reject }, r, qs);
    if (out === "created") created++; else if (out === "matched") matched++; else if (out === "duplicate") dup++;
  }
  const sample = { created, matched, duplicates: dup, mode: c.gateway.kind };
  if (page.nextStart !== undefined) return { cursor: { since, maxSeen, start: page.nextStart }, rowsIn: created + matched, rowsRejected: rejected, done: false, sample };
  return { cursor: { since: maxSeen }, rowsIn: created + matched, rowsRejected: rejected, done: true, sample };
}
