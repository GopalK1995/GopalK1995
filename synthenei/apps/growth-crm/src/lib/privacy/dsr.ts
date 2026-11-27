// Requester-facing side of the data-subject workflow (AUD-064): status links and authenticated delivery of access bundles. Pure over ports.
//   status   /privacy/<ws>/status/<token>: where the request stands and how much of the response window is left. Bounded views.
//   export   the owner creates a delivery link; the requester opens it, proves the verified address again, and downloads ONCE.
//            The bundle is built at download time (nothing is stored at rest), the download is audited, the link dies on use.
// Nothing here logs or audits a personal value: kinds, ids, counts and reasons only.
import { timingSafeEqual } from "node:crypto";
import { slaClock, type SlaClock } from "./due";
import { subjectRefOf, isEmail, normaliseEmail } from "./subject";
import { TOKEN_MAX_USES, TOKEN_TTL_MS, checkIssuedToken, issueToken, tokenHash, type TokenPort } from "./tokens";
import type { PublicWorkspace, RequestKind, RequestStatus } from "./types";

export interface DsrRequest {
  id: string; wsUuid: string; tenantUuid: string; leadId: string | null; subjectRef: string; kind: RequestKind; status: RequestStatus;
  receivedAt: string; dueAt: string; completedAt: string | null;
}
export interface DsrStore {
  workspaceBySlug(slug: string): Promise<PublicWorkspace | null>;
  workspaceById(id: string): Promise<PublicWorkspace | null>;
  requestById(wsUuid: string, id: string): Promise<DsrRequest | null>;
  /** Builds the access bundle for one request (service role, every query scoped by workspace and record). */
  buildBundle(i: { wsUuid: string; requestId: string; subjectRef: string; leadId: string }): Promise<unknown>;
}
export interface AuditEntry { action: string; wsUuid: string; requestId: string | null; summary: string; detail?: Record<string, unknown> }
export interface DsrDeps {
  store: DsrStore; tokens: TokenPort; secret: string; now: () => number;
  /** true = allowed. */
  rate: (key: string, limit: number, windowMs: number) => Promise<boolean>;
  /** Writes an audit row. Resolves false when it could not be written (callers that gate data on it must refuse). */
  audit: (e: AuditEntry) => Promise<boolean>;
}

export const EXPORT_LIMITS = { ip: { limit: 20, windowMs: 3_600_000 }, token: { limit: 5, windowMs: 3_600_000 } } as const;
export const statusPath = (slug: string, token: string): string => `/privacy/${encodeURIComponent(slug)}/status/${token}`;
export const exportPath = (slug: string, token: string): string => `/privacy/${encodeURIComponent(slug)}/export/${token}`;

const safeAudit = async (d: DsrDeps, e: AuditEntry): Promise<void> => { try { await d.audit(e); } catch { /* best effort: a status link is not gated on its audit row */ } };

// ---------- status links ----------
/** Issues a read-only status link for a request. Null when tokens are not available (migration pending) or the secret is unset. */
export async function issueStatusToken(d: Pick<DsrDeps, "tokens" | "secret" | "now" | "audit">, r: { wsUuid: string; tenantUuid: string; requestId: string }): Promise<string | null> {
  if (!d.secret) return null;
  try {
    const t = issueToken("status", d.secret);
    const out = await d.tokens.issue({ purpose: "status", wsUuid: r.wsUuid, tenantUuid: r.tenantUuid, requestId: r.requestId, hash: t.hash, expiresAt: new Date(d.now() + TOKEN_TTL_MS.status).toISOString(), maxUses: TOKEN_MAX_USES.status, createdBy: null });
    if (out !== "ok") return null;
    await safeAudit(d as DsrDeps, { action: "privacy.status_link_issued", wsUuid: r.wsUuid, requestId: r.requestId, summary: "Status link issued to a requester", detail: { purpose: "status" } });
    return t.token;
  } catch { return null; }
}

export type StatusView =
  | { status: "ok"; orgName: string; slug: string; kind: RequestKind; state: RequestStatus; receivedAt: string; dueAt: string; completedAt: string | null; clock: SlaClock }
  | { status: "invalid" | "expired" | "used" | "unavailable" };

export async function viewStatus(d: DsrDeps, slug: string, token: string): Promise<StatusView> {
  if (!d.secret) return { status: "unavailable" };
  if (!checkIssuedToken(token, "status", d.secret)) return { status: "invalid" };
  const ws = await d.store.workspaceBySlug(slug);
  if (!ws) return { status: "invalid" };
  const u = await d.tokens.use({ hash: tokenHash(token), purpose: "status", wsUuid: ws.wsUuid });
  if (!u.ok) return { status: u.reason === "expired" ? "expired" : u.reason === "used" ? "used" : u.reason === "unsupported" ? "unavailable" : "invalid" };
  const req = u.requestId ? await d.store.requestById(ws.wsUuid, u.requestId) : null;
  if (!req) return { status: "invalid" };
  return { status: "ok", orgName: ws.orgName, slug: ws.wsSlug, kind: req.kind, state: req.status, receivedAt: req.receivedAt, dueAt: req.dueAt, completedAt: req.completedAt, clock: slaClock(req.status, req.receivedAt, req.dueAt, d.now()) };
}

// ---------- delivery of access bundles ----------
export type DeliveryIssue = { status: "ok"; path: string; expiresAt: string } | { status: "not_access" | "no_lead" | "closed" | "not_found" | "unavailable" };

/** Owner side: a fresh single-use delivery link for one access request. A newer link replaces an unspent older one. */
export async function issueExportDelivery(d: DsrDeps, i: { wsUuid: string; requestId: string; createdBy: string }): Promise<DeliveryIssue> {
  if (!d.secret) return { status: "unavailable" };
  const req = await d.store.requestById(i.wsUuid, i.requestId);
  if (!req) return { status: "not_found" };
  if (req.kind !== "access") return { status: "not_access" };
  if (!req.leadId) return { status: "no_lead" };
  if (req.status === "rejected") return { status: "closed" };
  const slug = (await d.store.workspaceById(i.wsUuid))?.wsSlug;
  if (!slug) return { status: "unavailable" };
  const t = issueToken("export", d.secret);
  const expiresAt = new Date(d.now() + TOKEN_TTL_MS.export).toISOString();
  await d.tokens.revoke({ requestId: req.id, purpose: "export" });
  const out = await d.tokens.issue({ purpose: "export", wsUuid: req.wsUuid, tenantUuid: req.tenantUuid, requestId: req.id, hash: t.hash, expiresAt, maxUses: TOKEN_MAX_USES.export, createdBy: i.createdBy });
  if (out !== "ok") return { status: "unavailable" };
  await safeAudit(d, { action: "privacy.export_delivery_issued", wsUuid: req.wsUuid, requestId: req.id, summary: "Export delivery link issued", detail: { expiresAt, singleUse: true } });
  return { status: "ok", path: exportPath(slug, t.token), expiresAt };
}

export type ExportPreview = { status: "ready"; orgName: string; slug: string; expiresHint: boolean } | { status: "invalid" | "expired" | "used" | "unavailable" };
/** GET of the delivery page: shape, signature and state only. Never spends the link. */
export async function previewExport(d: DsrDeps, slug: string, token: string): Promise<ExportPreview> {
  if (!d.secret) return { status: "unavailable" };
  if (!checkIssuedToken(token, "export", d.secret)) return { status: "invalid" };
  const ws = await d.store.workspaceBySlug(slug);
  if (!ws) return { status: "invalid" };
  const p = await d.tokens.peek({ hash: tokenHash(token), purpose: "export", wsUuid: ws.wsUuid });
  if (p.state === "ok") return { status: "ready", orgName: ws.orgName, slug: ws.wsSlug, expiresHint: true };
  if (p.state === "expired") return { status: "expired" };
  if (p.state === "used") return { status: "used" };
  return { status: p.state === "unsupported" ? "unavailable" : "invalid" };
}

export type ExportResult =
  | { status: "ok"; filename: string; bundle: unknown }
  | { status: "invalid" | "expired" | "used" | "wrong_email" | "rate_limited" | "unavailable" | "no_lead" };

const sameRef = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * POST of the delivery page. Order matters:
 *  1. rate limit (per address and per link), signature, workspace
 *  2. peek (does not spend), request lookup, the typed address must hash to the request's subject_ref (wrong address: nothing is spent)
 *  3. spend the link atomically (a second tab or a replay stops here)
 *  4. audit; if the audit row cannot be written the bundle is NOT served (the link is already spent: the owner issues a new one)
 *  5. build the bundle now (nothing stored at rest)
 */
export async function redeemExport(d: DsrDeps, i: { slug: string; token: string; email: string; ip: string }): Promise<ExportResult> {
  if (!d.secret) return { status: "unavailable" };
  if (!checkIssuedToken(i.token, "export", d.secret)) return { status: "invalid" };
  const hash = tokenHash(i.token);
  if (!(await d.rate(`privacy-export:ip:${i.ip}`, EXPORT_LIMITS.ip.limit, EXPORT_LIMITS.ip.windowMs))) return { status: "rate_limited" };
  if (!(await d.rate(`privacy-export:tok:${hash}`, EXPORT_LIMITS.token.limit, EXPORT_LIMITS.token.windowMs))) return { status: "rate_limited" };
  const ws = await d.store.workspaceBySlug(i.slug);
  if (!ws) return { status: "invalid" };
  const p = await d.tokens.peek({ hash, purpose: "export", wsUuid: ws.wsUuid });
  if (p.state === "unsupported") return { status: "unavailable" };
  if (p.state === "expired") return { status: "expired" };
  if (p.state === "used") return { status: "used" };
  if (p.state !== "ok" || !p.requestId) return { status: "invalid" };
  const req = await d.store.requestById(ws.wsUuid, p.requestId);
  if (!req || req.kind !== "access" || req.status === "rejected") return { status: "invalid" };
  if (!req.leadId) return { status: "no_lead" };
  const email = normaliseEmail(i.email ?? "");
  if (!isEmail(email) || !sameRef(subjectRefOf(email), req.subjectRef)) {
    await safeAudit(d, { action: "privacy.export_denied", wsUuid: ws.wsUuid, requestId: req.id, summary: "Export download refused: address did not match", detail: { reason: "wrong_email" } });
    return { status: "wrong_email" };
  }
  const u = await d.tokens.use({ hash, purpose: "export", wsUuid: ws.wsUuid });
  if (!u.ok) return { status: u.reason === "expired" ? "expired" : u.reason === "used" ? "used" : u.reason === "unsupported" ? "unavailable" : "invalid" };
  const wrote = await d.audit({ action: "privacy.export_delivered", wsUuid: ws.wsUuid, requestId: req.id, summary: "Access bundle delivered to the requester", detail: { singleUse: true } }).catch(() => false);
  if (!wrote) return { status: "unavailable" };
  const bundle = await d.store.buildBundle({ wsUuid: ws.wsUuid, requestId: req.id, subjectRef: req.subjectRef, leadId: req.leadId });
  return { status: "ok", filename: `access-bundle-${req.id.slice(0, 8)}.json`, bundle };
}
