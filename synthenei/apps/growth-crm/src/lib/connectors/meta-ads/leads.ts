// Lead Ads: one leadgen webhook event -> fetch the lead by leadgen_id -> map form answers through the tenant's field map ->
// create or match a lead with source/campaign attribution and the consent the form captured. Idempotent: the leadgen id is an
// external link, so a redelivery (or Meta's own retry) is recognised and skipped before any vendor call.
// A person who already exists (same E.164 phone or lower email) keeps their first-touch attribution; only last-touch moves.
import { createHash } from "node:crypto";
import { contentHash } from "../core/upserter";
import { applyFieldMap, effectiveMap } from "../core/field-map";
import type { ConnectionRow, ConnectionSecrets, FieldMapSpec } from "../core/types";
import { CRED, FORM_CONSENT_PURPOSES, LEAD_OBJECT, OBJ, type FormConsentPurpose } from "./constants";
import type { GraphLead, MetaGateway } from "./gateway";
import type { LeadgenEvent } from "./payload";
import type { ConnScope, MetaDeps } from "./store";

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
export const scopeOf = (c: ConnectionRow): ConnScope => ({ tenantId: c.tenantId, workspaceId: c.workspaceId, connectionId: c.id });

/** Meta's standard form question names. The tenant's field-mapping editor adds or replaces rows (custom questions, other columns). */
export const DEFAULT_LEAD_MAP: FieldMapSpec[] = [
  { externalObject: LEAD_OBJECT, externalField: "full_name", localTable: "leads", localColumn: "full_name", direction: "in", transform: "trim" },
  { externalObject: LEAD_OBJECT, externalField: "email", localTable: "leads", localColumn: "email", direction: "in", transform: "lower_email" },
  { externalObject: LEAD_OBJECT, externalField: "phone_number", localTable: "leads", localColumn: "phone", direction: "in", transform: "e164_phone" },
  { externalObject: LEAD_OBJECT, externalField: "city", localTable: "leads", localColumn: "city", direction: "in", transform: "trim" },
  { externalObject: LEAD_OBJECT, externalField: "company_name", localTable: "leads", localColumn: "firm_name", direction: "in", transform: "trim" },
  { externalObject: LEAD_OBJECT, externalField: "job_title", localTable: "leads", localColumn: "role_title", direction: "in", transform: "trim" },
];

/** A consent rule: which form answer grants which purpose. `field` = a question answered yes, `checkbox` = a ticked disclaimer checkbox. */
export interface ConsentRule { source: "field" | "checkbox"; key: string; purpose: FormConsentPurpose }
const PURPOSES = new Set<string>(FORM_CONSENT_PURPOSES);

/** Tenant rules from connection settings (`consent_rules`). Without any, questions named consent_<purpose> are recognised. Never grants by default. */
export function consentRulesOf(settings: Record<string, unknown>): ConsentRule[] {
  const raw = Array.isArray(settings.consent_rules) ? settings.consent_rules : [];
  const own = raw.flatMap((r): ConsentRule[] => {
    const x = r as Record<string, unknown> | null;
    return x && (x.source === "field" || x.source === "checkbox") && typeof x.key === "string" && x.key && PURPOSES.has(String(x.purpose)) ? [{ source: x.source, key: x.key, purpose: x.purpose as FormConsentPurpose }] : [];
  });
  return [...own, ...FORM_CONSENT_PURPOSES.map((p): ConsentRule => ({ source: "field", key: `consent_${p}`, purpose: p }))];
}
const YES = /^(yes|y|true|1|on|checked|agree|agreed|i agree|accept|accepted|opt[ _-]?in)$/i;
export const isYes = (v: string | undefined): boolean => !!v && YES.test(v.trim());

/** Purposes this lead's form answers grant. A missing answer or an unticked box grants nothing. */
export function consentGrants(lead: GraphLead, rules: ConsentRule[]): FormConsentPurpose[] {
  const out = new Set<FormConsentPurpose>();
  for (const r of rules) {
    const hit = r.source === "field" ? isYes(lead.fields[r.key]) : lead.disclaimers.some((d) => d.key === r.key && d.checked);
    if (hit) out.add(r.purpose);
  }
  return [...out];
}

/** Flat record the field map reads: the form answers plus the common fallbacks (first + last name, work email / phone). */
export function recordOf(lead: GraphLead): Record<string, unknown> {
  const f = { ...lead.fields };
  if (!f.full_name) { const n = [f.first_name, f.last_name].filter(Boolean).join(" ").trim(); if (n) f.full_name = n; }
  if (!f.email && f.work_email) f.email = f.work_email;
  if (!f.phone_number && f.work_phone_number) f.phone_number = f.work_phone_number;
  return f;
}

/** Maps a lead through the effective field map (tenant rows replace defaults). Returns the leads-table row and the rejected fields. */
export function mapLead(lead: GraphLead, tenantMap: FieldMapSpec[]): { row: Record<string, unknown>; rejected: string[] } {
  const m = applyFieldMap(effectiveMap(DEFAULT_LEAD_MAP, tenantMap), LEAD_OBJECT, recordOf(lead));
  return { row: { ...(m.byTable.leads ?? {}) }, rejected: m.rejected.map((r) => `${r.reason}:${r.field}`) };
}

/** Attribution columns for a new lead. utm.* are the channel's own labels; campaign text is the ad campaign's name from Meta. */
export function attributionOf(lead: GraphLead, campaignId: string | null): Record<string, unknown> {
  const campaign = lead.campaignName ?? null;
  return {
    source: "meta", first_touch_channel: "meta", last_touch_channel: "meta", first_touch_campaign: campaign, last_touch_campaign: campaign,
    ...(campaignId ? { campaign_id: campaignId } : {}),
    utm: { source: lead.platform === "ig" ? "instagram" : "facebook", medium: lead.isOrganic ? "organic_lead_form" : "paid_social", ...(campaign ? { campaign } : {}), ...(lead.adName ? { content: lead.adName } : {}), ...(lead.adsetName ? { term: lead.adsetName } : {}) },
    external_ids: { meta_leadgen_id: lead.id, ...(lead.formId ? { meta_form_id: lead.formId } : {}), ...(lead.adId ? { meta_ad_id: lead.adId } : {}) },
  };
}

/** Tenant isolation: a leadgen event is processed only for the page this connection selected. */
export const ownsPage = (secrets: ConnectionSecrets, pageId: string): boolean => !!secrets[CRED.pageId] && secrets[CRED.pageId] === pageId;

export interface LeadCtx { deps: MetaDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: MetaGateway; reject: (reason: string) => void }
export type LeadOutcome = "created" | "matched" | "duplicate" | "rejected";

export async function handleLeadgen(c: LeadCtx, evt: LeadgenEvent): Promise<LeadOutcome> {
  const { deps, conn } = c;
  if (!ownsPage(c.secrets, evt.pageId)) { c.reject("page_mismatch"); return "rejected"; }   // never touch another workspace's page
  if (await deps.core.getLink(conn.id, OBJ.lead, evt.leadgenId)) return "duplicate";

  const lead = await c.gateway.getLead(evt.leadgenId);   // a dead token throws CredentialError: the connection needs attention
  if (!lead) { c.reject("lead_unavailable"); return "rejected"; }
  const { row: mapped, rejected } = mapLead(lead, await deps.core.getFieldMap(conn.id));
  for (const r of rejected) c.reject(r);
  const email = typeof mapped.email === "string" ? mapped.email : null, phone = typeof mapped.phone === "string" ? mapped.phone : null;
  if (!email && !phone) { c.reject("no_contact"); return "rejected"; }

  let campaignId: string | null = null;
  if (lead.campaignId) {
    try { campaignId = await deps.store.ensureCampaign({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, externalId: lead.campaignId, name: lead.campaignName ?? `Campaign ${lead.campaignId}`, synthetic: c.gateway.kind === "mock" }); }
    catch { deps.log.warn("meta campaign not linked", { connection: conn.id }); }   // attribution text still stands without the link
  }

  const attribution = attributionOf(lead, campaignId);
  const at = evt.at;
  let leadId = await deps.core.findByMatchKey("leads", conn.workspaceId, { phone: phone ?? undefined, email: email ?? undefined });
  const created = leadId === null;
  if (leadId) {
    // Existing person: keep first touch and source, move last touch only.
    await deps.core.updateLocal("leads", leadId, { last_touch_channel: "meta", last_touch_campaign: attribution.last_touch_campaign ?? null, last_touch_at: at });
  } else {
    const name = (typeof mapped.full_name === "string" && mapped.full_name) || email || phone || "Lead";
    leadId = await deps.core.insertLocal("leads", { ...attribution, ...mapped, full_name: name, last_touch_at: at, tenant_id: conn.tenantId, workspace_id: conn.workspaceId });
  }
  await deps.core.putLink({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, connectionId: conn.id, externalObject: OBJ.lead, externalId: evt.leadgenId, localTable: "leads", localId: leadId, contentHash: contentHash({ id: lead.id, fields: lead.fields }), direction: "in" });

  const subject = sha256Hex(email ?? (phone as string));
  for (const purpose of consentGrants(lead, consentRulesOf(conn.settings))) {
    const wrote = await deps.store.recordConsentOnce({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, leadId, subjectRef: subject, purpose, noticeVersion: `meta-lead-form:${lead.formId ?? "unknown"}`, note: `meta leadgen ${lead.id}` });
    if (wrote) await deps.store.emit({ type: "consent.changed", workspaceId: conn.workspaceId, objectType: "lead", objectId: leadId, data: { purpose, action: "granted", via: "integration" } });
  }
  return created ? "created" : "matched";
}

