// Owner-side repository for privacy requests. Runs on the SIGNED-IN user's client, so RLS (privacy.fulfil in the workspace, real members
// only, no delete) is the second line behind assertCan. The register is never deleted from: closing a request is a status change.
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { throwIfError } from "@/lib/db/errors";
import { canMove } from "./due";
import { isRequestKind, REQUEST_STATUSES, type PrivacyRequest, type RequestStatus } from "./types";

type R = Record<string, unknown>;
const COLS = "id, workspace_id, subject_ref, lead_id, kind, received_at, due_at, status, handled_by, export_path, notes, completed_at";

export function mapRequest(r: R): PrivacyRequest {
  const status = REQUEST_STATUSES.includes(r.status as RequestStatus) ? (r.status as RequestStatus) : "received";
  return {
    id: String(r.id), workspaceId: String(r.workspace_id), subjectRef: String(r.subject_ref), leadId: r.lead_id ? String(r.lead_id) : null,
    kind: isRequestKind(r.kind) ? r.kind : "grievance", receivedAt: String(r.received_at), dueAt: String(r.due_at), status,
    handledBy: r.handled_by ? String(r.handled_by) : null, exportPath: r.export_path ? String(r.export_path) : null,
    notes: r.notes ? String(r.notes) : null, completedAt: r.completed_at ? String(r.completed_at) : null,
  };
}

export class RequestError extends Error { constructor(public code: "not_found" | "bad_transition" | "lead_not_found", message: string) { super(message); } }

export function ownerRepo(db: Db, workspaceId: string) {
  const q = () => from(db, "privacy_requests");
  async function get(id: string): Promise<PrivacyRequest> {
    const r = await q().select(COLS).eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    throwIfError(r.error);
    if (!r.data) throw new RequestError("not_found", "request not found");
    return mapRequest(r.data as R);
  }
  return {
    get,
    async list(limit = 200): Promise<PrivacyRequest[]> {
      const r = await q().select(COLS).eq("workspace_id", workspaceId).order("due_at", { ascending: true }).limit(limit);
      throwIfError(r.error);
      return ((r.data as R[] | null) ?? []).map(mapRequest);
    },
    /** Moves a request along its allowed path. Closing needs the caller's note so the register says what was done. */
    async setStatus(id: string, to: RequestStatus, note?: string): Promise<PrivacyRequest> {
      const cur = await get(id);
      if (!canMove(cur.status, to)) throw new RequestError("bad_transition", `cannot move ${cur.status} to ${to}`);
      const notes = note ? [cur.notes, `${new Date().toISOString().slice(0, 10)}: ${note}`].filter(Boolean).join("\n").slice(0, 4000) : cur.notes;
      const r = await q().update({ status: to, notes }).eq("id", id).eq("workspace_id", workspaceId).select(COLS);
      throwIfError(r.error);
      const row = ((r.data as R[] | null) ?? [])[0];
      if (!row) throw new RequestError("not_found", "request not found");
      return mapRequest(row);
    },
    async appendNote(id: string, note: string): Promise<void> {
      const cur = await get(id);
      const notes = [cur.notes, `${new Date().toISOString().slice(0, 10)}: ${note}`].filter(Boolean).join("\n").slice(0, 4000);
      const r = await q().update({ notes }).eq("id", id).eq("workspace_id", workspaceId).select("id");
      throwIfError(r.error);
    },
    /** Attach the request to a lead the owner found by hand (the requester's address matched nobody). */
    async linkLead(id: string, leadId: string): Promise<void> {
      const l = await from(db, "leads").select("id").eq("id", leadId).eq("workspace_id", workspaceId).maybeSingle();
      throwIfError(l.error);
      if (!l.data) throw new RequestError("lead_not_found", "lead not found in this workspace");
      const r = await q().update({ lead_id: leadId }).eq("id", id).eq("workspace_id", workspaceId).select("id");
      throwIfError(r.error);
    },
  };
}
