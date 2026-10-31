// WhatsApp customer-care window: free text only within 24 h of the contact's last inbound message.
// Pure and timezone-safe: both instants are absolute (epoch ms). A timestamp with no offset is read as UTC, never as
// the server's or the viewer's local time, so IST (+05:30) deployments cannot shift the window by hours.
export const WINDOW_MS = 24 * 3600e3;

export function toMs(t: string | Date | null | undefined): number | null {
  if (t == null) return null;
  if (t instanceof Date) return Number.isFinite(t.getTime()) ? t.getTime() : null;
  const s = t.trim();
  if (!s) return null;
  const hasZone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(s);
  const iso = hasZone ? s : `${s.replace(" ", "T")}${/T/.test(s.replace(" ", "T")) ? "" : "T00:00:00"}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export interface WindowState {
  /** true when free text may be sent (or the channel has no window) */
  open: boolean;
  /** channel has a window at all */
  applies: boolean;
  leftMs: number | null;
}

export function windowState(channel: string, lastInboundAt: string | Date | null | undefined, now: string | Date): WindowState {
  if (channel !== "whatsapp") return { open: true, applies: false, leftMs: null };
  const last = toMs(lastInboundAt), n = toMs(now);
  if (last === null || n === null) return { open: false, applies: true, leftMs: 0 }; // no inbound yet: templates only
  const leftMs = last + WINDOW_MS - n;
  return { open: leftMs > 0, applies: true, leftMs: Math.max(0, leftMs) };
}

/** Hours left for the UI bar; null when the channel has no window. */
export const leftHours = (w: WindowState): number | null => (w.applies ? (w.leftMs ?? 0) / 3600e3 : null);

/** Consent purpose checked by public.can_contact for a 1:1 message on a channel. */
export function purposeFor(channel: string): "whatsapp" | "marketing_email" | "demo_followup" {
  return channel === "whatsapp" ? "whatsapp" : channel === "email" ? "marketing_email" : "demo_followup";
}
