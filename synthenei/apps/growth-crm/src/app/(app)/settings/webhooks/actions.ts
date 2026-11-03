"use server";
// Endpoint management. Every action: zod -> gate (webhooks.manage, never in support, org policy allow_webhooks) -> SSRF check on the
// URL -> write -> audit. The signing secret leaves the server once, in the create/rotate result. Demo sessions validate and answer
// but write nothing and make no network call.
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { requireActive } from "@/lib/auth/server";
import { can, AuthzError } from "@/lib/authz/engine";
import { assertCan } from "@/lib/authz/load";
import { dbForRequest } from "@/lib/db/client";
import { DbError, throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import { serviceDb } from "@/lib/db/service";
import { createEndpoint, deleteEndpoint, getEndpoint, pingEndpoint, replayDelivery, rotateSecret, updateEndpoint } from "@/lib/webhooks/admin";
import { splitEventTypes } from "@/lib/webhooks/options";
import { checkUrl, endpointInput, endpointPatch, filterError, idInput, optionsOf, replayInput } from "@/lib/webhooks/schemas";
import { wh } from "./_lib/strings";
import type { IssuedSecret, TestOutcome } from "./_lib/types";

const denyBlocked = (perm: string) => new AuthzError({ allow: false, reason: "support_blocked", step: 4, permission: perm, maskedFields: [] });

async function gate(opts: { owner?: boolean } = {}) {
  const { session, active } = await requireActive();
  if (active.support) throw denyBlocked("webhooks.manage");
  const demo = session.demo === true;
  const principal = await assertCan(demo ? "integrations.manage" : "webhooks.manage");
  if (opts.owner && active.role !== "owner") throw new AuthzError({ allow: false, reason: "out_of_scope", step: 4, permission: "webhooks.manage", maskedFields: [] });
  let tenantUuid = "";
  let policyOff = false;
  if (!demo) {
    const db = await dbForRequest();
    const r = await from(db, "workspaces").select("tenant_id").eq("id", active.ws.uuid).maybeSingle();
    throwIfError(r.error);
    tenantUuid = String((r.data as { tenant_id?: string } | null)?.tenant_id ?? "");
    if (!tenantUuid) throw new AuthzError({ allow: false, reason: "out_of_scope", step: 1, permission: "webhooks.manage", maskedFields: [] });
    const pol = await from(db, "org_admin_policies").select("allow_webhooks").eq("tenant_id", tenantUuid).maybeSingle();
    policyOff = !pol.error && (pol.data as { allow_webhooks?: boolean } | null)?.allow_webhooks === false;
  }
  return { demo, uid: session.uid, principal, wsUuid: active.ws.uuid, tenantUuid, policyOff, mayPii: can(principal, "pii.read") };
}
type Ctx = Awaited<ReturnType<typeof gate>>;

const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return "endpoint"; } };
async function record(c: Ctx, action: string, summary: string, id: string, detail: Record<string, unknown> = {}) {
  try { await audit(actorFromPrincipal(c.principal, { demo: c.demo }), { action, summary, object: { table: "webhook_endpoints", id }, detail }); }
  catch { console.error("[webhooks] audit write failed", action); }
}

export async function createEndpointAction(raw: unknown): Promise<ActionResult<IssuedSecret>> {
  return runAction<IssuedSecret>(async () => {
    const p = endpointInput.safeParse(raw);
    if (!p.success) return failResult("invalid", wh("invalidBody"), { issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: wh(i.message) })) });
    const c = await gate();
    if (c.policyOff) return failResult("denied", wh("policyOff"));
    if (p.data.includePii && !c.mayPii) return failResult("denied", wh("piiNotAllowed"));
    const fe = filterError(p.data);
    if (fe) return failResult("invalid", wh(fe));
    const ue = await checkUrl(p.data.url);
    if (ue) return failResult("invalid", wh(ue), { issues: [{ path: "url", message: wh(ue) }] });
    if (c.demo) return okResult<IssuedSecret>(wh("created"), { sub: wh("demoNotSaved") });
    try {
      const { endpoint, secret } = await createEndpoint(await dbForRequest(), serviceDb(), {
        tenantId: c.tenantUuid, workspaceId: c.wsUuid, createdBy: c.uid, url: p.data.url, description: p.data.description?.trim() || null, eventTypes: p.data.eventTypes, options: optionsOf(p.data),
      });
      await record(c, "webhook.endpoint_created", `Added webhook endpoint ${hostOf(endpoint.url)}`, endpoint.id, { events: p.data.eventTypes.length, pii: p.data.includePii });
      return okResult<IssuedSecret>(wh("created"), { data: { id: endpoint.id, secret } });
    } catch (e) {
      if (e instanceof DbError && e.code === "invalid" && e.detail === "endpoint limit reached") return failResult("invalid", wh("limitReached"));
      throw e;
    }
  });
}

export async function updateEndpointAction(raw: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const p = endpointPatch.safeParse(raw);
    if (!p.success) return failResult("invalid", wh("invalidBody"), { issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: wh(i.message) })) });
    const c = await gate();
    if (c.policyOff) return failResult("denied", wh("policyOff"));
    const d = p.data;
    if (d.includePii && !c.mayPii) return failResult("denied", wh("piiNotAllowed"));
    if (d.filters) { const fe = filterError({ filters: d.filters }); if (fe) return failResult("invalid", wh(fe)); }
    if (d.url) { const ue = await checkUrl(d.url); if (ue) return failResult("invalid", wh(ue), { issues: [{ path: "url", message: wh(ue) }] }); }
    if (c.demo) return okResult(wh("updated"), { sub: wh("demoNotSaved") });
    const req = await dbForRequest();
    const cur = await getEndpoint(req, c.wsUuid, d.id);
    if (!cur) return failResult("not_found", wh("notFound"));
    const split = splitEventTypes(cur.eventTypes);
    const options = d.includePii !== undefined || d.filters !== undefined ? { pii: d.includePii ?? split.options.pii, filters: d.filters ?? split.options.filters } : undefined;
    // A resume re-checks the destination too: DNS may have changed while the endpoint was paused.
    if (d.active === true && !d.url) { const ue = await checkUrl(cur.url); if (ue) return failResult("invalid", wh(ue)); }
    await updateEndpoint(req, c.wsUuid, d.id, { url: d.url, description: d.description === undefined ? undefined : d.description?.trim() || null, eventTypes: d.eventTypes, options, active: d.active }, cur);
    await record(c, d.active === undefined ? "webhook.endpoint_updated" : d.active ? "webhook.endpoint_resumed" : "webhook.endpoint_paused", `${d.active === undefined ? "Edited" : d.active ? "Resumed" : "Paused"} webhook endpoint ${hostOf(d.url ?? cur.url)}`, d.id);
    return okResult(d.active === undefined ? wh("updated") : d.active ? wh("resumed") : wh("paused"));
  });
}

export async function deleteEndpointAction(raw: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const p = idInput.safeParse(raw);
    if (!p.success) return failResult("invalid", wh("invalidBody"));
    const c = await gate();
    if (c.demo) return okResult(wh("deleted"), { sub: wh("demoNotSaved") });
    const req = await dbForRequest();
    const cur = await getEndpoint(req, c.wsUuid, p.data.id);
    if (!cur) return failResult("not_found", wh("notFound"));
    await deleteEndpoint(req, serviceDb(), c.wsUuid, cur);
    await record(c, "webhook.endpoint_deleted", `Deleted webhook endpoint ${hostOf(cur.url)}`, cur.id);
    return okResult(wh("deleted"));
  });
}

export async function rotateSecretAction(raw: unknown): Promise<ActionResult<IssuedSecret>> {
  return runAction<IssuedSecret>(async () => {
    const p = idInput.safeParse(raw);
    if (!p.success) return failResult("invalid", wh("invalidBody"));
    const c = await gate();
    if (c.policyOff) return failResult("denied", wh("policyOff"));
    if (c.demo) return okResult<IssuedSecret>(wh("rotated"), { sub: wh("demoNotSaved") });
    const req = await dbForRequest();
    const cur = await getEndpoint(req, c.wsUuid, p.data.id);
    if (!cur) return failResult("not_found", wh("notFound"));
    const out = await rotateSecret(req, serviceDb(), c.wsUuid, cur);
    await record(c, "webhook.secret_rotated", `Rotated the signing secret for ${hostOf(cur.url)}`, cur.id, { grace_until: out.graceUntil });
    return okResult<IssuedSecret>(wh("rotated"), { data: { id: cur.id, secret: out.secret, graceUntil: out.graceUntil } });
  });
}

export async function testEndpointAction(raw: unknown): Promise<ActionResult<TestOutcome>> {
  return runAction<TestOutcome>(async () => {
    const p = idInput.safeParse(raw);
    if (!p.success) return failResult("invalid", wh("invalidBody"));
    const c = await gate();
    if (c.demo) return okResult<TestOutcome>(wh("testSimulated"), { data: { ok: true, status: 200, ms: 0, why: null, simulated: true } });
    const cur = await getEndpoint(await dbForRequest(), c.wsUuid, p.data.id);
    if (!cur) return failResult("not_found", wh("notFound"));
    const r = await pingEndpoint(serviceDb(), cur);
    const why = r.ok ? null : wh(`why_${r.kind ?? "connection"}`, { status: r.status ?? "" });
    return okResult<TestOutcome>(r.ok ? wh("testOk", { status: r.status ?? 200, ms: r.ms }) : wh("testFail", { why: why ?? "" }), { data: { ok: r.ok, status: r.status, ms: r.ms, why, simulated: false } });
  });
}

export async function replayDeliveryAction(raw: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const p = replayInput.safeParse(raw);
    if (!p.success) return failResult("invalid", wh("invalidBody"));
    const c = await gate({ owner: true });
    if (c.demo) return okResult(wh("replayed"), { sub: wh("demoNotSaved") });
    const req = await dbForRequest();
    const cur = await getEndpoint(req, c.wsUuid, p.data.endpointId);
    if (!cur) return failResult("not_found", wh("notFound"));
    // Audit first and let a failure stop the replay: an unaudited replay must not happen.
    await audit(actorFromPrincipal(c.principal), { action: "webhook.delivery_replayed", summary: `Replayed a delivery to ${hostOf(cur.url)}`, object: { table: "webhook_endpoints", id: cur.id }, detail: { delivery_id: p.data.deliveryId } });
    const r = await replayDelivery(req, serviceDb(), cur, p.data.deliveryId);
    if (!r.ok) return failResult(r.reason === "not_found" ? "not_found" : "invalid", wh(`replay_${r.reason}`));
    return okResult(wh("replayed"));
  });
}
