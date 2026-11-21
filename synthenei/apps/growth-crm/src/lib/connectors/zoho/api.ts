// Zoho CRM v6 gateway: COQL for incremental reads (ordered by Modified_Time), the records API for reads by id and writes.
// Fields are exchanged under the names used in the field map; `Full_Name` is synthetic (First_Name + Last_Name).
// Every value interpolated into a COQL query is validated first (field names, timestamps); record ids are digits only.
import type { VendorHttp } from "../core/types";
import { expandDotted } from "./engine/map";
import { RecordRejected, type CrmGateway, type CrmObject, type RemotePage, type RemoteRecord } from "./engine/types";
import { CRM_API_PATH, MAX_OFFSET, MODULE, PAGE_SIZE } from "./constants";

const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,60}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ID_RE = /^\d{1,25}$/;
const EPOCH = "2000-01-01T00:00:00+00:00";

interface Cursor { since: string; offset: number }
const isCursor = (x: unknown): x is Cursor => !!x && typeof x === "object" && typeof (x as Cursor).since === "string" && typeof (x as Cursor).offset === "number";
/** ISO instant -> the offset form COQL expects. Zoho's own timestamps already have it and pass through. */
export function toZohoTs(s: string): string {
  if (TS_RE.test(s) && !s.endsWith("Z")) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return EPOCH;
  return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function splitName(full: string): { First_Name?: string; Last_Name: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { Last_Name: parts[0] ?? "" };
  return { First_Name: parts.slice(0, -1).join(" "), Last_Name: parts[parts.length - 1] };
}

/** Wanted external fields -> the module fields to select (synthetic expanded, dotted lookups reduced to their root). */
export function selectFields(o: CrmObject, wanted: string[]): string[] {
  const out = new Set<string>(["id", "Modified_Time"]);
  for (const w of wanted) {
    if (w === "Full_Name") { out.add("First_Name"); out.add("Last_Name"); continue; }
    const root = w.split(".")[0];
    if (FIELD_RE.test(root)) out.add(root);
  }
  void o;
  return [...out].slice(0, 50);
}

function toRecord(o: CrmObject, row: Record<string, unknown>): RemoteRecord {
  const fields: Record<string, unknown> = { ...row };
  if (o === "lead" || o === "contact") fields.Full_Name = [row.First_Name, row.Last_Name].filter((x) => typeof x === "string" && x.trim()).join(" ") || null;
  return { id: String(row.id), modifiedAt: typeof row.Modified_Time === "string" ? row.Modified_Time : null, fields };
}

/** Outbound payload: synthetic and dotted fields turned into what the API accepts. */
export function toPayload(o: CrmObject, fields: Record<string, unknown>): Record<string, unknown> {
  const { Full_Name, ...rest } = fields as Record<string, unknown> & { Full_Name?: unknown };
  const out = expandDotted(rest);
  if ((o === "lead" || o === "contact") && "Full_Name" in fields) Object.assign(out, typeof Full_Name === "string" && Full_Name.trim() ? splitName(Full_Name) : {});
  return out;
}

interface WriteResult { data?: { code?: string; status?: string; details?: { id?: string; Modified_Time?: string; duplicate_record?: { id?: string } } }[] }
function outcome(res: WriteResult | undefined): { id: string | null; modifiedAt: string | null } {
  const r = res?.data?.[0];
  if (!r || r.status === "error" || (r.code && r.code !== "SUCCESS")) throw new RecordRejected(String(r?.code ?? "UNKNOWN").replace(/[^A-Z0-9_]/gi, "").slice(0, 40) || "UNKNOWN", r?.details?.duplicate_record?.id ? String(r.details.duplicate_record.id) : undefined);
  return { id: r.details?.id ? String(r.details.id) : null, modifiedAt: r.details?.Modified_Time ?? null };
}

export function makeZohoGateway(i: { http: VendorHttp; apiBase: string; token: string }): CrmGateway {
  const base = `${i.apiBase.replace(/\/+$/, "")}${CRM_API_PATH}`;
  const headers = { authorization: `Zoho-oauthtoken ${i.token}` };
  return {
    objectName: (o) => MODULE[o],

    async list(o, cursor, wanted, startSince): Promise<RemotePage> {
      const cur: Cursor = isCursor(cursor) ? cursor : { since: toZohoTs(startSince ?? EPOCH), offset: 0 };
      if (!TS_RE.test(cur.since)) throw new Error("Zoho cursor is not a timestamp");
      const fields = selectFields(o, wanted);
      const q = `select ${fields.join(", ")} from ${MODULE[o]} where Modified_Time >= '${cur.since}' order by Modified_Time asc limit ${Math.max(0, Math.floor(cur.offset))}, ${PAGE_SIZE}`;
      const res = await i.http.json<{ data?: Record<string, unknown>[]; info?: { more_records?: boolean } } | undefined>({ method: "POST", url: `${base}/coql`, headers, body: { select_query: q } });
      const records = (res?.data ?? []).map((r) => toRecord(o, r));
      const lastTs = records.length ? records[records.length - 1].modifiedAt : null;
      if (!res?.info?.more_records) return { records, cursor: { since: lastTs ?? cur.since, offset: 0 } satisfies Cursor, done: true };
      // window exhausted (COQL offsets are capped): restart from the last Modified_Time; the boundary rows are re-read and reconcile as no-ops
      if (cur.offset + PAGE_SIZE >= MAX_OFFSET && lastTs) return { records, cursor: { since: lastTs, offset: 0 } satisfies Cursor, done: false };
      return { records, cursor: { since: cur.since, offset: cur.offset + PAGE_SIZE } satisfies Cursor, done: false };
    },

    async getMany(o, ids, wanted) {
      const clean = ids.filter((x) => ID_RE.test(x));
      if (!clean.length) return [];
      const fields = selectFields(o, wanted).filter((f) => f !== "id");
      const res = await i.http.json<{ data?: Record<string, unknown>[] } | undefined>({ method: "GET", url: `${base}/${MODULE[o]}?ids=${clean.join(",")}&fields=${fields.join(",")}`, headers });
      return (res?.data ?? []).map((r) => toRecord(o, r));
    },

    async create(o, fields) {
      const res = await i.http.json<WriteResult | undefined>({ method: "POST", url: `${base}/${MODULE[o]}`, headers, body: { data: [toPayload(o, fields)] } });
      const r = outcome(res);
      if (!r.id) throw new RecordRejected("NO_ID");
      return { id: r.id, modifiedAt: r.modifiedAt };
    },

    async update(o, id, fields) {
      if (!ID_RE.test(id)) throw new RecordRejected("BAD_ID");
      const res = await i.http.json<WriteResult | undefined>({ method: "PUT", url: `${base}/${MODULE[o]}/${id}`, headers, body: { data: [toPayload(o, fields)] } });
      return { modifiedAt: outcome(res).modifiedAt };
    },
  };
}
