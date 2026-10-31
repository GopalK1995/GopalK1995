// Read side of the audit log: filtered keyset listing, row mapping, PII masking and CSV. Read-only by construction:
// this module only ever builds select queries (a test asserts no insert/update/delete/upsert/rpc is issued).
import type { Db } from "@/lib/db/client";
import { DbError, throwIfError } from "@/lib/db/errors";
import { clampLimit, decodeCursor, encodeCursor, type Page } from "@/lib/db/page";
import { from, type Qb } from "@/lib/db/query";
import { isSecretKey, maskPiiText, redactDetail, scrubSecretsText } from "./redact";
import { AUDIT_SOURCES, type AuditFilters, type AuditView } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/;
const unsafe = (v: string) => /["\\]/.test(v);

export interface AuditScope {
  /** org viewer: always set (RLS repeats it). Platform viewer: omit, optionally filter via AuditFilters.tenant/workspace. */
  workspaceId?: string;
  /** tenant tab: all workspaces of one tenant (uuids) */
  workspaceIds?: string[];
}

/** Keeps only well-formed filter values; anything else is dropped, never passed to the database. */
export function cleanFilters(f: AuditFilters): AuditFilters {
  const out: AuditFilters = {};
  const t = (v?: string) => (v ?? "").trim();
  if (t(f.actor)) out.actor = t(f.actor).slice(0, 80);
  if (/^[a-z][a-z0-9_.:-]{0,63}$/.test(t(f.action))) out.action = t(f.action);
  const [tbl, rid] = t(f.object).split(":");
  if (IDENT_RE.test(tbl ?? "")) out.object = rid && !unsafe(rid) && rid.length <= 64 ? `${tbl}:${rid}` : tbl;
  if ((AUDIT_SOURCES as readonly string[]).includes(t(f.source))) out.source = t(f.source);
  if (DATE_RE.test(t(f.from))) out.from = t(f.from);
  if (DATE_RE.test(t(f.to))) out.to = t(f.to);
  if (SLUG_RE.test(t(f.tenant))) out.tenant = t(f.tenant);
  if (SLUG_RE.test(t(f.workspace))) out.workspace = t(f.workspace);
  return out;
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const likeEscape = (s: string) => s.replace(/[\\%_,()]/g, " ").trim();

function applyFilters(q: Qb, scope: AuditScope, raw: AuditFilters): Qb {
  const f = cleanFilters(raw);
  let out = q;
  if (scope.workspaceId) out = out.eq("workspace_id", scope.workspaceId);
  else if (scope.workspaceIds) out = out.in("workspace_id", scope.workspaceIds.filter((w) => UUID_RE.test(w)));
  else {
    if (f.tenant && UUID_RE.test(f.tenant)) out = out.eq("tenant_id", f.tenant);
    if (f.workspace && UUID_RE.test(f.workspace)) out = out.eq("workspace_id", f.workspace);
  }
  if (f.actor) out = UUID_RE.test(f.actor) ? out.eq("actor_id", f.actor) : out.ilike("actor_label", `%${likeEscape(f.actor)}%`);
  if (f.action) out = out.eq("action", f.action);
  if (f.object) {
    const [tbl, rid] = f.object.split(":");
    out = out.eq("table_name", tbl);
    if (rid) out = out.eq("row_id", rid);
  }
  if (f.source) out = out.eq("source", f.source);
  // India time day boundaries
  if (f.from) out = out.gte("occurred_at", `${f.from}T00:00:00+05:30`);
  if (f.to) out = out.lt("occurred_at", `${nextDay(f.to)}T00:00:00+05:30`);
  return out;
}

type Raw = Record<string, unknown>;
const s = (v: unknown, d = "") => (v == null ? d : String(v));
const sn = (v: unknown) => (v == null || v === "" ? null : String(v));

export function toAuditView(r: Raw): AuditView {
  const table = s(r.table_name), action = s(r.action);
  return {
    id: s(r.id), at: s(r.occurred_at), actorId: sn(r.actor_id), actorLabel: s(r.actor_label, "system"), actorKind: s(r.actor_kind, "user"),
    action, summary: s(r.summary) || `${action} ${table}`.trim(), objectTable: table, objectId: sn(r.row_id), source: s(r.source, "ui"),
    reason: sn(r.reason), requestId: sn(r.request_id), ip: s(r.ip), userAgent: s(r.user_agent), supportSessionId: sn(r.support_session_id),
    tenantId: sn(r.tenant_id), workspaceId: sn(r.workspace_id), changes: r.changes ?? null,
    support: r.support_session_id != null || r.source === "support" || r.actor_kind === "support",
  };
}

/**
 * PII masking for display and export. Callers without pii.read lose the IP and user agent, and every personal value
 * inside text and the change set. Secrets are scrubbed for everyone, including readers who may see personal data.
 */
export function maskAuditView(v: AuditView, piiRead: boolean): AuditView {
  const text = (x: string) => (piiRead ? scrubSecretsText(x) : maskPiiText(scrubSecretsText(x)));
  return {
    ...v,
    ip: piiRead ? v.ip : "", userAgent: piiRead ? v.userAgent : "",
    summary: text(v.summary), reason: v.reason == null ? null : text(v.reason),
    changes: v.changes == null ? null : piiRead ? scrubOnly(v.changes) : redactDetail(v.changes),
  };
}
/** Secret keys removed, personal fields kept (for readers who may see them). */
function scrubOnly(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return scrubSecretsText(v);
  if (depth > 6 || v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => scrubOnly(x, depth + 1));
  const out: Raw = {};
  for (const [k, val] of Object.entries(v as Raw)) out[k] = isSecretKey(k) ? "[redacted]" : scrubOnly(val, depth + 1);
  return out;
}

/** One page, newest first, keyset on (occurred_at desc, id desc). */
export async function queryAudit(db: Db, scope: AuditScope, filters: AuditFilters, cursor?: string, limitIn?: number): Promise<Page<AuditView>> {
  const limit = clampLimit(limitIn);
  let qb = applyFilters(from(db, "audit_log").select(), scope, filters);
  if (cursor) {
    const c = decodeCursor(cursor);
    if (!c || unsafe(String(c.v)) || !/^\d{1,18}$/.test(String(c.id))) throw new DbError("invalid", "invalid", { detail: "bad cursor" });
    qb = qb.or(`occurred_at.lt."${c.v}",and(occurred_at.eq."${c.v}",id.lt.${c.id})`);
  }
  qb = qb.order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  const { data, error } = await qb;
  throwIfError(error);
  const all = ((data as Raw[] | null) ?? []).map(toAuditView);
  const rows = all.slice(0, limit);
  const last = rows[rows.length - 1];
  return { rows, nextCursor: all.length > limit && last ? encodeCursor({ v: last.at, id: last.id }) : null };
}

export const MAX_EXPORT_ROWS = 5000;
/** Walks the keyset pages up to MAX_EXPORT_ROWS. `truncated` is true when more rows exist. */
export async function queryAuditAll(db: Db, scope: AuditScope, filters: AuditFilters): Promise<{ rows: AuditView[]; truncated: boolean }> {
  const rows: AuditView[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await queryAudit(db, scope, filters, cursor, 200);
    rows.push(...page.rows);
    if (!page.nextCursor) return { rows, truncated: false };
    if (rows.length >= MAX_EXPORT_ROWS) return { rows: rows.slice(0, MAX_EXPORT_ROWS), truncated: true };
    cursor = page.nextCursor;
  }
}

const CSV_COLS: [string, (v: AuditView) => string][] = [
  ["when_utc", (v) => v.at], ["actor", (v) => v.actorLabel], ["actor_kind", (v) => v.actorKind], ["action", (v) => v.action],
  ["summary", (v) => v.summary], ["object", (v) => (v.objectId ? `${v.objectTable}:${v.objectId}` : v.objectTable)], ["source", (v) => v.source],
  ["reason", (v) => v.reason ?? ""], ["support_session", (v) => v.supportSessionId ?? ""], ["request_id", (v) => v.requestId ?? ""], ["ip", (v) => v.ip],
];
/** A cell that starts with = + - @ tab or CR is neutralised so spreadsheets do not run it as a formula. */
export function csvCell(raw: string): string {
  const x = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
}
/** Rows must already be masked (maskAuditView). */
export function auditCsv(rows: AuditView[]): string {
  return [CSV_COLS.map(([h]) => h).join(","), ...rows.map((r) => CSV_COLS.map(([, f]) => csvCell(f(r))).join(","))].join("\r\n") + "\r\n";
}

/** Reads search params into filters (strings only). */
export function filtersFromParams(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const g = (k: string) => { const v = sp[k]; return typeof v === "string" ? v : undefined; };
  return cleanFilters({ actor: g("actor"), action: g("action"), object: g("object"), source: g("source"), from: g("from"), to: g("to"), tenant: g("tenant"), workspace: g("workspace") });
}
