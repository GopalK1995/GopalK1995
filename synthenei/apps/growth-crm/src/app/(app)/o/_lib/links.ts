// Pure helpers for record links (record_links): which end is the other one, and where a linked record lives in the app.
import { objectUrl } from "@/lib/notify/urls";
import type { LinkRow } from "./types";

/** The other end of a link, seen from (type, id). */
export function otherEnd(l: LinkRow, type: string, id: string): { direction: "from" | "to"; type: string; id: string } {
  return l.fromType === type && l.fromId === id ? { direction: "to", type: l.toType, id: l.toId } : { direction: "from", type: l.fromType, id: l.fromId };
}

/** In-app path of a linked record: custom objects open under /o, system records on their own pages. Null when there is no page. */
export function hrefFor(type: string, id: string): string | null {
  if (type.startsWith("obj:")) return `/o/${type.slice(4)}/${id}`;
  const u = objectUrl(type, id);
  return u && !u.startsWith("/records/") ? u : null;
}
