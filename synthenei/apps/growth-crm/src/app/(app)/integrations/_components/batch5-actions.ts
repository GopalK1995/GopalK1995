"use server";
// Batch 5 connector actions (LinkedIn, Slack, Google Business Profile, Outlook, iCal). Every action calls manageCtx() first
// (assertCan("integrations.manage"); support sessions are blocked), refuses demo workspaces, validates ids with zod and passes the audit
// writer of the signed-in user so a failed audit row fails the action. Tokens, feed URLs and secrets never appear in a result.
import "@/lib/connectors/all";
import { z } from "zod";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { failResult, okResult, runAction, type ActionFailCode, type ActionResult } from "@/lib/actions/result";
import { requestRuntime } from "@/lib/connectors/core/runtime";
import { listLinkedInAccounts, selectLinkedInAccount, supabaseLinkedInStore } from "@/lib/connectors/linkedin";
import { listSlackChannels, selectSlackChannel, sendSlackTest } from "@/lib/connectors/slack/assets";
import { listGbpLocations, selectGbpLocation } from "@/lib/connectors/google/business-profile";
import { subscribeOutlook } from "@/lib/connectors/microsoft";
import { serviceMsRuntime } from "@/lib/connectors/microsoft/runtime";
import { addFeed, removeFeed, createExportToken, revokeExportToken, exportPath } from "@/lib/connectors/ical";
import { icalServiceDeps } from "@/lib/connectors/ical/runtime";
import { serviceDb } from "@/lib/db/service";
import { manageCtx, type IntCtx } from "../_lib/ctx";

const uuid = z.string().uuid();
const ONLY_REAL = "Not available in a demo workspace.";

type Fail = { ok: false; code: string };
const failCode = (code: string): ActionFailCode =>
  code === "not_found" ? "not_found" : code === "account_taken" ? "conflict" : /^invalid|not_available|channel_not_available|account_not_available/.test(code) ? "invalid" : "error";
const toResult = <T>(r: { ok: true; value: T } | Fail, okMessage: string, pick: (v: T) => unknown = (v) => v): ActionResult<unknown> =>
  r.ok ? okResult(okMessage, { data: pick(r.value) }) : failResult(failCode(r.code), r.code);

const actorOf = (c: IntCtx) => ({ uid: c.uid, tenantId: c.tenant, workspaceId: c.ws });
const auditFor = (c: IntCtx) => async (e: { action: string; summary: string; connectionId: string; detail?: Record<string, unknown> }) => {
  await audit(actorFromPrincipal(c.principal), { action: e.action, summary: e.summary, object: { table: "integrations", id: e.connectionId }, detail: e.detail });
};
const rtFor = (c: IntCtx) => requestRuntime(auditFor(c));
const realCtx = async (): Promise<IntCtx | null> => { const c = await manageCtx(); return c.demo ? null : c; };

// ---- LinkedIn ----
export async function listLinkedInAccountsAction(connectionId: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const id = uuid.parse(connectionId); const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    return toResult(await listLinkedInAccounts(await rtFor(c), actorOf(c), id), "ok");
  });
}
export async function selectLinkedInAccountAction(connectionId: string, accountId: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const i = z.object({ conn: uuid, account: z.string().regex(/^[0-9]{1,20}$/) }).parse({ conn: connectionId, account: accountId });
    const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    return toResult(await selectLinkedInAccount(await rtFor(c), supabaseLinkedInStore(serviceDb()), actorOf(c), i.conn, i.account), "Ad account selected");
  });
}

// ---- Slack ----
export async function listSlackChannelsAction(connectionId: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const id = uuid.parse(connectionId); const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    return toResult(await listSlackChannels(await rtFor(c), actorOf(c), id), "ok");
  });
}
export async function selectSlackChannelAction(connectionId: string, choice: { channelId: string; alerts?: string[]; includeNames?: boolean; locale?: "en" | "ta" }): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const i = z.object({ conn: uuid, ch: z.object({ channelId: z.string().regex(/^[A-Z0-9]{3,20}$/), alerts: z.array(z.string().max(40)).max(20).optional(), includeNames: z.boolean().optional(), locale: z.enum(["en", "ta"]).optional() }) }).parse({ conn: connectionId, ch: choice });
    const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    return toResult(await selectSlackChannel(await rtFor(c), actorOf(c), i.conn, i.ch as Parameters<typeof selectSlackChannel>[3]), "Slack channel selected");
  });
}
export async function sendSlackTestAction(connectionId: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const id = uuid.parse(connectionId); const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    return toResult(await sendSlackTest(await rtFor(c), actorOf(c), id), "Test message sent");
  });
}

// ---- Google Business Profile ----
export async function listGbpLocationsAction(connectionId: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const id = uuid.parse(connectionId); const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    return toResult(await listGbpLocations(await rtFor(c), actorOf(c), id), "ok");
  });
}
export async function selectGbpLocationAction(connectionId: string, account: string, location: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const i = z.object({ conn: uuid, account: z.string().min(1).max(80), location: z.string().min(1).max(80) }).parse({ conn: connectionId, account, location });
    const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    return toResult(await selectGbpLocation(await rtFor(c), actorOf(c), i.conn, { account: i.account, location: i.location }), "Listing selected");
  });
}

// ---- Outlook ----
export async function subscribeOutlookAction(connectionId: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const id = uuid.parse(connectionId); const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    const ms = await serviceMsRuntime();
    return toResult(await subscribeOutlook({ ...ms, rd: { ...ms.rd, audit: auditFor(c) } }, actorOf(c), id), "Notifications repaired");
  });
}

// ---- iCal (feeds and export tokens). The audit row is the signed-in user's, so the action fails when it cannot be written. ----
const icalDeps = (c: IntCtx) => ({ ...icalServiceDeps(c.ws), audit: async (e: { action: string; summary: string; detail?: Record<string, unknown> }) => { await audit(actorFromPrincipal(c.principal), { action: e.action, summary: e.summary, detail: e.detail }); } }) as ReturnType<typeof icalServiceDeps>;
const SOURCE = z.enum(["airbnb", "booking_com", "other"]);

export async function addIcalFeedAction(connectionId: string, input: { propertyKey: string; source: string; label?: string; url: string; timezone?: string | null }): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const i = z.object({ conn: uuid, p: z.object({ propertyKey: z.string().min(1).max(80), source: SOURCE, label: z.string().max(80).optional(), url: z.string().url().max(2048), timezone: z.string().max(64).nullable().optional() }) }).parse({ conn: connectionId, p: input });
    const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    const r = await addFeed(icalDeps(c), actorOf(c), { scope: { tenantId: c.tenant, workspaceId: c.ws, connectionId: i.conn }, ...i.p });
    return toResult(r, "Feed added", (f) => ({ id: (f as { id: string }).id }));
  });
}
export async function removeIcalFeedAction(connectionId: string, feedId: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const i = z.object({ conn: uuid, feed: uuid }).parse({ conn: connectionId, feed: feedId });
    const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    return toResult(await removeFeed(icalDeps(c), actorOf(c), { tenantId: c.tenant, workspaceId: c.ws, connectionId: i.conn }, i.feed), "Feed removed");
  });
}
/** The returned `path` carries the plaintext token: shown once by the UI, never stored (only its SHA-256 is). */
export async function createIcalExportTokenAction(propertyKey: string, excludeSource?: string | null): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const i = z.object({ p: z.string().min(1).max(80), x: SOURCE.nullable().optional() }).parse({ p: propertyKey, x: excludeSource ?? null });
    const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    return toResult(await createExportToken(icalDeps(c), actorOf(c), { propertyKey: i.p, excludeSource: i.x ?? null }), "Export link created", (v) => ({ path: exportPath((v as { token: string }).token) }));
  });
}
export async function revokeIcalExportTokenAction(tokenId: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const id = uuid.parse(tokenId); const c = await realCtx(); if (!c) return failResult("invalid", ONLY_REAL);
    return toResult(await revokeExportToken(icalDeps(c), actorOf(c), id), "Export link revoked");
  });
}
