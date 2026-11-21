// Server-action target: create a CRM event (demo, meeting, room hold) in the acting user's own Google calendar and in calendar_events.
// The caller (a server action behind `activities.write`) builds RuntimeDeps with requestRuntime(audit) and the actor from the session.
// Tenant isolation: the connection must belong to the actor's tenant and workspace; a foreign id looks exactly like a missing one.
import type { RuntimeDeps } from "../../core/ports";
import { loadSecrets } from "../../core/secrets";
import { CredentialError } from "../../core/types";
import { connectionOf, isUsable, type Actor, type SelectResult } from "../shared/select";
import { calendarGatewayFor } from "./config";
import { CALENDAR_CONNECTOR_ID, EVENT_KINDS, MAX_TITLE, type EventKind } from "./constants";
import { grantFor } from "./grants";
import { toGoogleEvent } from "./mapper";
import type { CalendarDeps } from "./store";
import type { CalStatus } from "./types";

export interface NewCalendarEvent { title: string; startsAt: string; endsAt: string; kind: EventKind; objectType?: string; objectId?: string }

export async function createCalendarEvent(d: RuntimeDeps, deps: CalendarDeps, actor: Actor, connectionId: string, input: NewCalendarEvent, fetchImpl?: typeof fetch): Promise<SelectResult<{ localId: string }>> {
  const conn = await connectionOf(d, actor, connectionId, CALENDAR_CONNECTOR_ID);
  if (!conn) return { ok: false, code: "not_found" };
  if (!isUsable(conn)) return { ok: false, code: "not_connected" };
  const s = Date.parse(input.startsAt), e = Date.parse(input.endsAt), title = input.title.trim();
  if (!title || title.length > MAX_TITLE || Number.isNaN(s) || Number.isNaN(e) || e < s || !(EVENT_KINDS as readonly string[]).includes(input.kind)) return { ok: false, code: "invalid_input" };
  if ((input.objectType && !/^(lead|contact|account|deal|obj:[a-z0-9_]{1,40})$/.test(input.objectType)) || (input.objectId && !/^[0-9a-zA-Z_-]{1,64}$/.test(input.objectId))) return { ok: false, code: "invalid_input" };
  const secrets = await loadSecrets(d.vault, conn);
  const gateway = calendarGatewayFor({ secrets, env: d.env, fetchImpl });
  const grant = gateway.kind === "mock" ? { uid: "showcase", access: "mock" } : grantFor(secrets, actor.uid);
  if (!grant) return { ok: false, code: "not_connected" };
  const status: CalStatus = input.kind === "room_hold" ? "tentative" : "confirmed";
  const row = { title, startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString(), status, objectType: input.objectType ?? null, objectId: input.objectId ?? null };
  try {
    const made = await gateway.insertEvent(grant.access, toGoogleEvent(row, input.kind));
    const localId = await deps.store.insertLinked({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, connectionId: conn.id }, { ...row, externalId: `${grant.uid}:${made.id}` });
    if (d.audit) { try { await d.audit({ action: "gcal.event_created", summary: "Created a calendar event", connectionId: conn.id, detail: { kind: input.kind, local: localId } }); } catch { return { ok: false, code: "audit_failed" }; } }
    return { ok: true, value: { localId } };
  } catch (err) {
    if (err instanceof CredentialError) return { ok: false, code: "token_rejected" };
    throw err;
  }
}
