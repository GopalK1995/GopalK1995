// RFC 5545 reader for the subset OTA calendar feeds use. Pure, never throws on hostile input except IcalParseError for "this is not a calendar".
// Handles: CRLF / LF / CR line ends, line unfolding, quoted parameters, TEXT unescaping, DATE and DATE-TIME values (UTC "Z", TZID, floating),
// DURATION, STATUS, SEQUENCE, LAST-MODIFIED, nested components (VALARM, VTIMEZONE are skipped), size and event-count caps.
// Not handled on purpose: recurrence (RRULE / RDATE / EXDATE): OTAs list every night they close, so a recurring event is rejected, not guessed.
import { PARSE_MAX_EVENTS, PARSE_MAX_LINE } from "./constants";

export class IcalParseError extends Error { constructor(public code: "not_ical" | "empty") { super(code); this.name = "IcalParseError"; } }

export interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }
export type IcalTime =
  | { kind: "date"; date: string }
  | { kind: "utc"; ms: number }
  | { kind: "zoned"; tzid: string; wall: Wall }
  | { kind: "floating"; wall: Wall };

export interface IcalEvent {
  uid: string; sequence: number; status: "CONFIRMED" | "TENTATIVE" | "CANCELLED" | null;
  summary: string; dtstart: IcalTime | null; dtend: IcalTime | null; duration: { days: number; ms: number } | null;
  lastModifiedMs: number | null; hasRecurrence: boolean;
}
export interface ParsedCalendar { events: IcalEvent[]; rejected: { reason: string }[] }

interface Line { name: string; params: Record<string, string>; value: string }

const unfold = (t: string): string[] => t.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");

/** name;PARAM=v;PARAM="q:uoted":value. Quotes protect ':' and ';' inside parameter values. */
function parseLine(raw: string): Line | null {
  if (!raw || raw.length > PARSE_MAX_LINE) return null;
  let inQ = false, colon = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') inQ = !inQ;
    else if (c === ":" && !inQ) { colon = i; break; }
  }
  if (colon < 1) return null;
  const head: string[] = [];
  let cur = "";
  inQ = false;
  for (const c of raw.slice(0, colon)) {
    if (c === '"') inQ = !inQ;
    if (c === ";" && !inQ) { head.push(cur); cur = ""; } else cur += c;
  }
  head.push(cur);
  const name = head[0].trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const p of head.slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 1) continue;
    params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return { name, params, value: raw.slice(colon + 1) };
}

const unescapeText = (v: string): string => v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));

const validWall = (w: Wall): boolean => {
  if (w.mo < 1 || w.mo > 12 || w.d < 1 || w.h > 23 || w.mi > 59 || w.s > 60 || w.y < 1970 || w.y > 2200) return false;
  const dim = new Date(Date.UTC(w.y, w.mo, 0)).getUTCDate();
  return w.d <= dim;
};

export function parseTime(l: Line): IcalTime | null {
  const v = l.value.trim();
  const dateOnly = l.params.VALUE === "DATE" || /^\d{8}$/.test(v);
  if (dateOnly) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (!m) return null;
    const w: Wall = { y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0, s: 0 };
    return validWall(w) ? { kind: "date", date: `${m[1]}-${m[2]}-${m[3]}` } : null;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(v);
  if (!m) return null;
  const w: Wall = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: Math.min(+m[6], 59) };
  if (!validWall(w)) return null;
  if (m[7]) return { kind: "utc", ms: Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) };
  const tzid = l.params.TZID;
  return tzid ? { kind: "zoned", tzid, wall: w } : { kind: "floating", wall: w };
}

/** P1W2DT3H4M5S -> whole days plus the remaining milliseconds; null when malformed. Negative durations are rejected. */
export function parseDuration(v: string): { days: number; ms: number } | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(v.trim());
  if (!m || v.trim() === "P" || /T$/i.test(v.trim())) return null;
  const n = (x: string | undefined) => (x ? Number(x) : 0);
  const days = n(m[1]) * 7 + n(m[2]);
  const ms = ((n(m[3]) * 60 + n(m[4])) * 60 + n(m[5])) * 1000;
  return days > 4000 ? null : { days, ms };
}

export function parseIcs(text: string): ParsedCalendar {
  const lines = unfold(text);
  const stack: string[] = [];
  let sawCalendar = false;
  const events: IcalEvent[] = [];
  const rejected: { reason: string }[] = [];
  let cur: (Partial<IcalEvent> & { _bad?: string }) | null = null;

  for (const raw of lines) {
    const l = parseLine(raw);
    if (!l) continue;
    if (l.name === "BEGIN") {
      const comp = l.value.trim().toUpperCase();
      stack.push(comp);
      if (comp === "VCALENDAR") sawCalendar = true;
      if (comp === "VEVENT" && stack.length === 2 && stack[0] === "VCALENDAR") cur = { sequence: 0, status: null, summary: "", dtstart: null, dtend: null, duration: null, lastModifiedMs: null, hasRecurrence: false };
      continue;
    }
    if (l.name === "END") {
      const comp = l.value.trim().toUpperCase();
      if (comp === "VEVENT" && cur && stack.length === 2) {
        if (events.length + rejected.length >= PARSE_MAX_EVENTS) { rejected.push({ reason: "too_many_events" }); cur = null; stack.pop(); break; }
        if (cur._bad) rejected.push({ reason: cur._bad });
        else if (!cur.uid) rejected.push({ reason: "no_uid" });
        else if (cur.hasRecurrence) rejected.push({ reason: "recurrence_unsupported" });
        else if (!cur.dtstart) rejected.push({ reason: "no_start" });
        else events.push(cur as IcalEvent);
        cur = null;
      }
      const at = stack.lastIndexOf(comp);
      if (at >= 0) stack.length = at;
      continue;
    }
    // Properties only count directly inside a top-level VEVENT (not inside a nested VALARM).
    if (!cur || stack.length !== 2 || stack[1] !== "VEVENT") continue;
    switch (l.name) {
      case "UID": { const u = l.value.trim(); if (u) cur.uid = u.slice(0, 300); break; }
      case "SUMMARY": cur.summary = unescapeText(l.value).slice(0, 200); break;
      case "STATUS": { const s = l.value.trim().toUpperCase(); cur.status = s === "CANCELLED" || s === "CONFIRMED" || s === "TENTATIVE" ? s : null; break; }
      case "SEQUENCE": { const n = Number(l.value.trim()); cur.sequence = Number.isInteger(n) && n >= 0 && n < 1e9 ? n : 0; break; }
      case "LAST-MODIFIED": { const t = parseTime({ ...l, params: {} }); cur.lastModifiedMs = t?.kind === "utc" ? t.ms : null; break; }
      case "DTSTART": { const t = parseTime(l); if (t) cur.dtstart = t; else cur._bad = "bad_start"; break; }
      case "DTEND": { const t = parseTime(l); if (t) cur.dtend = t; else cur._bad = "bad_end"; break; }
      case "DURATION": { const d = parseDuration(l.value); if (d) cur.duration = d; else cur._bad = "bad_duration"; break; }
      case "RRULE": case "RDATE": case "EXDATE": cur.hasRecurrence = true; break;
      case "RECURRENCE-ID": cur.hasRecurrence = true; break;
      default: break;
    }
  }
  if (!sawCalendar) throw new IcalParseError("not_ical");
  return { events, rejected };
}

/** A feed is "an iCalendar document" when it declares a VCALENDAR; anything else (an HTML login page, a JSON error) is not. */
export const looksLikeIcs = (text: string): boolean => /^\s*BEGIN:VCALENDAR/im.test(text.slice(0, 4096));
