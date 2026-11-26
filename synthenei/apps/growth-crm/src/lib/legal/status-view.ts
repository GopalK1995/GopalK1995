// What the public deletion-status page says for each request state. Pure, so it is unit-tested. Never shows the Meta user id.
import type { DeletionRow, DeletionStatus } from "./meta-deletion";

export type StatusView = { kind: "found"; status: DeletionStatus; title: string; body: string; requested: string; completed: string | null }
  | { kind: "not_found" } | { kind: "unavailable" } | { kind: "missing_code" };

const COPY: Record<DeletionStatus, { title: string; body: string }> = {
  received: { title: "Request received", body: "We have recorded your deletion request. We are matching it to the data we hold and will erase it. Quote the confirmation code if you contact us." },
  disconnected: { title: "Access removed, data erasure in progress", body: "The stored access credentials for your connected account have been removed. We are now erasing the data already collected." },
  completed: { title: "Deletion completed", body: "The data we held for this request has been erased." },
};

const day = (iso: string): string => { const t = Date.parse(iso); return Number.isNaN(t) ? iso : new Date(t).toISOString().slice(0, 10); };

export function statusView(row: DeletionRow | null | "unavailable", code: string | undefined): StatusView {
  if (row === "unavailable") return { kind: "unavailable" };
  if (!code) return { kind: "missing_code" };
  if (!row) return { kind: "not_found" };
  const c = COPY[row.status];
  return { kind: "found", status: row.status, title: c.title, body: c.body, requested: day(row.requestedAt), completed: row.completedAt ? day(row.completedAt) : null };
}
