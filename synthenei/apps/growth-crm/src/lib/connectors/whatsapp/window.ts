// 24-hour customer-service window. Pure, epoch-ms arithmetic: an offset-less timestamp is read as UTC, never as local time.
import { SERVICE_WINDOW_MS } from "./constants";

export function toMs(t: string | Date | null | undefined): number | null {
  if (t == null) return null;
  if (t instanceof Date) return Number.isFinite(t.getTime()) ? t.getTime() : null;
  const s = t.trim();
  if (!s) return null;
  const hasZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(s);
  const norm = s.replace(" ", "T");
  const ms = Date.parse(hasZone ? norm : `${norm}${/T/.test(norm) ? "" : "T00:00:00"}Z`);
  return Number.isFinite(ms) ? ms : null;
}

export interface ServiceWindow { open: boolean; leftMs: number }

/** Free text is allowed only while last inbound + 24 h is in the future. No inbound yet = closed (templates only). */
export function serviceWindow(lastInboundAt: string | Date | null | undefined, now: string | Date): ServiceWindow {
  const last = toMs(lastInboundAt), n = toMs(now);
  if (last === null || n === null) return { open: false, leftMs: 0 };
  const leftMs = last + SERVICE_WINDOW_MS - n;
  return { open: leftMs > 0, leftMs: Math.max(0, leftMs) };
}
