// HubSpot CRM v3 gateway: the search API (sorted by last-modified) for incremental reads, batch read by id, create and update.
// Properties are exchanged under the names used in the field map; `full_name` is synthetic (firstname + lastname). Search is paced
// (5 requests a second per account) and reads at most 10,000 results per query, so a long window restarts from the last timestamp.
import type { VendorHttp } from "../core/types";
import { RecordRejected, type CrmGateway, type CrmObject, type RemotePage, type RemoteRecord } from "../zoho/engine/types";
import { MAX_AFTER, PAGE_SIZE, SEARCH_PACE_MS } from "./constants";

export const OBJECT_NAME: Record<CrmObject, string> = { lead: "contacts", contact: "contacts", account: "companies", deal: "deals" };
const MODIFIED_PROP: Record<string, string> = { contacts: "lastmodifieddate", companies: "hs_lastmodifieddate", deals: "hs_lastmodifieddate" };
const NUMERIC = new Set(["amount"]);
const PROP_RE = /^[a-z][a-z0-9_]{0,99}$/;
const ID_RE = /^\d{1,25}$/;

interface Cursor { since: string; after?: string }
const isCursor = (x: unknown): x is Cursor => !!x && typeof x === "object" && typeof (x as Cursor).since === "string";

export const propsFor = (wanted: string[]): string[] => {
  const out = new Set<string>();
  for (const w of wanted) { if (w === "full_name") { out.add("firstname"); out.add("lastname"); } else if (PROP_RE.test(w)) out.add(w); }
  return [...out];
};

export function splitName(full: string): { firstname: string; lastname: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts.length <= 1 ? { firstname: "", lastname: parts[0] ?? "" } : { firstname: parts.slice(0, -1).join(" "), lastname: parts[parts.length - 1] };
}

interface RawRecord { id: string; updatedAt?: string; properties?: Record<string, unknown> }
function toRecord(o: CrmObject, r: RawRecord): RemoteRecord {
  const fields: Record<string, unknown> = { ...(r.properties ?? {}) };
  for (const k of NUMERIC) if (typeof fields[k] === "string" && fields[k] !== "" && Number.isFinite(Number(fields[k]))) fields[k] = Number(fields[k]);
  if (OBJECT_NAME[o] === "contacts") fields.full_name = [fields.firstname, fields.lastname].filter((x) => typeof x === "string" && x.trim()).join(" ") || null;
  return { id: String(r.id), modifiedAt: r.updatedAt ?? (typeof fields[MODIFIED_PROP[OBJECT_NAME[o]]] === "string" ? (fields[MODIFIED_PROP[OBJECT_NAME[o]]] as string) : null), fields };
}

/** Outbound properties: synthetic fields expanded, nulls sent as empty strings (HubSpot's way to clear a property), numbers as strings. */
export function toProperties(o: CrmObject, fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === "full_name") { if (OBJECT_NAME[o] === "contacts" && typeof v === "string") Object.assign(out, splitName(v)); continue; }
    if (PROP_RE.test(k)) out[k] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

/** HubSpot reports a rejected single record as HTTP 400/409/422; the shared client only keeps the status in its message. */
function asRejection(e: unknown): RecordRejected | null {
  const m = e instanceof Error ? /\(HTTP (400|409|422)\)/.exec(e.message) : null;
  return m ? new RecordRejected(m[1] === "409" ? "DUPLICATE" : "INVALID") : null;
}

export function makeHubspotGateway(i: { http: VendorHttp; apiBase: string; token: string; sleep?: (ms: number) => Promise<void>; now?: () => number }): CrmGateway {
  const base = i.apiBase.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${i.token}` };
  const sleep = i.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = i.now ?? Date.now;
  let last = 0;
  const pace = async () => { const wait = last + SEARCH_PACE_MS - now(); if (wait > 0) await sleep(wait); last = now(); };

  return {
    objectName: (o) => OBJECT_NAME[o],

    async list(o, cursor, wanted, startSince): Promise<RemotePage> {
      const type = OBJECT_NAME[o], prop = MODIFIED_PROP[type];
      const cur: Cursor = isCursor(cursor) ? cursor : { since: new Date(startSince ?? 0).toISOString() };
      const ms = Date.parse(cur.since);
      if (Number.isNaN(ms)) throw new Error("HubSpot cursor is not a timestamp");
      await pace();
      const res = await i.http.json<{ results?: RawRecord[]; paging?: { next?: { after?: string } } }>({
        method: "POST", url: `${base}/crm/v3/objects/${type}/search`, headers,
        body: { filterGroups: [{ filters: [{ propertyName: prop, operator: "GTE", value: String(ms) }] }], sorts: [{ propertyName: prop, direction: "ASCENDING" }], properties: propsFor(wanted), limit: PAGE_SIZE, ...(cur.after ? { after: cur.after } : {}) },
      });
      const records = (res.results ?? []).map((r) => toRecord(o, r));
      const lastTs = records.length ? records[records.length - 1].modifiedAt : null;
      const next = res.paging?.next?.after;
      if (!next) return { records, cursor: { since: lastTs ?? cur.since } satisfies Cursor, done: true };
      // search stops at 10,000 results: restart from the last timestamp; the boundary records are re-read and reconcile as no-ops
      if (Number(next) >= MAX_AFTER && lastTs) return { records, cursor: { since: lastTs } satisfies Cursor, done: false };
      return { records, cursor: { since: cur.since, after: next } satisfies Cursor, done: false };
    },

    async getMany(o, ids, wanted) {
      const clean = ids.filter((x) => ID_RE.test(x));
      if (!clean.length) return [];
      const res = await i.http.json<{ results?: RawRecord[] }>({ method: "POST", url: `${base}/crm/v3/objects/${OBJECT_NAME[o]}/batch/read`, headers, body: { properties: propsFor(wanted), inputs: clean.map((id) => ({ id })) } });
      return (res.results ?? []).map((r) => toRecord(o, r));
    },

    async create(o, fields) {
      try {
        const r = await i.http.json<RawRecord>({ method: "POST", url: `${base}/crm/v3/objects/${OBJECT_NAME[o]}`, headers, body: { properties: toProperties(o, fields) } });
        return { id: String(r.id), modifiedAt: r.updatedAt ?? null };
      } catch (e) { throw asRejection(e) ?? e; }
    },

    async update(o, id, fields) {
      if (!ID_RE.test(id)) throw new RecordRejected("BAD_ID");
      try {
        const r = await i.http.json<RawRecord>({ method: "PATCH", url: `${base}/crm/v3/objects/${OBJECT_NAME[o]}/${id}`, headers, body: { properties: toProperties(o, fields) } });
        return { modifiedAt: r.updatedAt ?? null };
      } catch (e) { throw asRejection(e) ?? e; }
    },
  };
}
