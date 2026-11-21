// Management operations behind the iCal settings screen: add / remove an import feed, create / revoke an export token. Pure orchestration
// over IcalDeps. The server action that calls these has already passed assertCan("integrations.manage") and loaded the connection through
// the signed-in user's client; these functions add the tenant check, input validation, the audit row (written FIRST: audit or nothing) and
// never put a feed URL or a token into an audit row, a log line or an error.
import { clip } from "../channel-manager/mapper";
import { validZone } from "../channel-manager/tz";
import { ICAL_FEED_SOURCES, MAX_FEEDS_PER_WORKSPACE, type FeedSource } from "./constants";
import { hashToken, newToken } from "./export";
import { FeedFetchError } from "./fetch-types";
import { IcalParseError, looksLikeIcs, parseIcs } from "./parser";
import { checkFeedUrl } from "./ssrf";
import type { FeedRow, FeedScope, IcalDeps, TokenRow } from "./store";

export interface Actor { uid: string; tenantId: string; workspaceId: string }
export type ManageFail = "invalid_property" | "invalid_source" | "invalid_label" | "invalid_timezone" | "limit_reached" | "not_found" | "audit_failed"
  | `url_${string}` | "unreachable" | "not_ical" | "empty_calendar";
export type ManageResult<T> = { ok: true; value: T } | { ok: false; code: ManageFail };

const cleanProperty = (s: unknown): string | null => (typeof s === "string" ? clip(s, 80) : null);
const isSource = (s: unknown): s is FeedSource => (ICAL_FEED_SOURCES as readonly string[]).includes(s as string);

async function audited(deps: IcalDeps, e: { action: string; summary: string; detail?: Record<string, unknown> }): Promise<boolean> {
  try { await deps.audit(e); return true; } catch { return false; }
}

/** One fetch + parse to prove the link works before it is saved. Returns the number of events, or a failure code. */
export async function probeFeed(deps: IcalDeps, url: string): Promise<{ ok: true; events: number } | { ok: false; code: ManageFail }> {
  const chk = checkFeedUrl(url);
  if (!chk.ok) return { ok: false, code: `url_${chk.reason}` };
  try {
    const res = await deps.fetch(chk.url.toString());
    if (res.status !== 200) return { ok: false, code: "unreachable" };
    if (!looksLikeIcs(res.body)) return { ok: false, code: "not_ical" };
    return { ok: true, events: parseIcs(res.body).events.length };
  } catch (e) {
    if (e instanceof IcalParseError) return { ok: false, code: "not_ical" };
    if (e instanceof FeedFetchError) return { ok: false, code: e.code === "blocked_address" || e.code === "bad_url" ? "url_blocked_host" : "unreachable" };
    return { ok: false, code: "unreachable" };
  }
}

export interface AddFeedInput { scope: FeedScope; propertyKey: string; source: string; label?: string; url: string; timezone?: string | null }

export async function addFeed(deps: IcalDeps, actor: Actor, i: AddFeedInput): Promise<ManageResult<FeedRow>> {
  if (i.scope.tenantId !== actor.tenantId || i.scope.workspaceId !== actor.workspaceId) return { ok: false, code: "not_found" };
  const property = cleanProperty(i.propertyKey);
  if (!property) return { ok: false, code: "invalid_property" };
  if (!isSource(i.source)) return { ok: false, code: "invalid_source" };
  const label = clip(i.label ?? "", 80) ?? "";
  if (i.timezone && !validZone(i.timezone)) return { ok: false, code: "invalid_timezone" };
  if ((await deps.store.countFeeds(actor)) >= MAX_FEEDS_PER_WORKSPACE) return { ok: false, code: "limit_reached" };
  const probe = await probeFeed(deps, i.url);
  if (!probe.ok) return probe;
  const host = new URL(i.url.trim()).hostname;
  if (!(await audited(deps, { action: "ical.feed_added", summary: `Added a ${i.source} calendar feed for ${property}`, detail: { source: i.source, property, host } }))) return { ok: false, code: "audit_failed" };
  const row = await deps.store.createFeed({ tenantId: actor.tenantId, workspaceId: actor.workspaceId, connectionId: i.scope.connectionId, propertyKey: property, source: i.source, label, timezone: i.timezone || null, url: i.url.trim() });
  return { ok: true, value: row };
}

export async function removeFeed(deps: IcalDeps, actor: Actor, scope: FeedScope, feedId: string): Promise<ManageResult<{ id: string }>> {
  if (scope.tenantId !== actor.tenantId || scope.workspaceId !== actor.workspaceId) return { ok: false, code: "not_found" };
  if (!(await audited(deps, { action: "ical.feed_removed", summary: "Removed a calendar feed", detail: { feed: feedId } }))) return { ok: false, code: "audit_failed" };
  return (await deps.store.deleteFeed(scope, feedId)) ? { ok: true, value: { id: feedId } } : { ok: false, code: "not_found" };
}

/** Creates an export token. The plaintext is returned ONCE (to show the owner the URL); only its hash is stored. */
export async function createExportToken(deps: IcalDeps, actor: Actor, i: { propertyKey: string; excludeSource?: string | null }): Promise<ManageResult<{ token: string; row: TokenRow; path: string }>> {
  const property = cleanProperty(i.propertyKey);
  if (!property) return { ok: false, code: "invalid_property" };
  if (i.excludeSource && !isSource(i.excludeSource)) return { ok: false, code: "invalid_source" };
  if (!(await audited(deps, { action: "ical.token_created", summary: `Created an availability feed link for ${property}`, detail: { property, excludeSource: i.excludeSource ?? null } }))) return { ok: false, code: "audit_failed" };
  const token = newToken();
  const row = await deps.store.createToken({ tenantId: actor.tenantId, workspaceId: actor.workspaceId, propertyKey: property, excludeSource: (i.excludeSource as FeedSource | null) ?? null, tokenHash: hashToken(token), createdBy: actor.uid });
  return { ok: true, value: { token, row, path: exportPath(token) } };
}

export async function revokeExportToken(deps: IcalDeps, actor: Actor, tokenId: string): Promise<ManageResult<{ id: string }>> {
  if (!(await audited(deps, { action: "ical.token_revoked", summary: "Revoked an availability feed link", detail: { token: tokenId } }))) return { ok: false, code: "audit_failed" };
  return (await deps.store.revokeToken(actor, tokenId, deps.now().toISOString())) ? { ok: true, value: { id: tokenId } } : { ok: false, code: "not_found" };
}

/** The path the integrator's route serves. The host comes from the deployment's base URL, never from this code. */
export const exportPath = (token: string): string => `/api/ical/${token}.ics`;
