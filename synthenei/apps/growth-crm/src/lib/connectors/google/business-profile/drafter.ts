// Reply drafting. The drafter only ever produces TEXT for a human to read; nothing here can approve or post. An AI provider plugs in
// through ReplyDrafter (injected by the server action; no model, key or prompt lives in the connector). The default is a rule-based
// template drafter that needs no provider, so the flow works on day one.
import { MAX_REPLY_LEN } from "./constants";

export interface ReviewForDraft { rating: number; text: string | null; author: string | null }
export interface ReplyDrafter { readonly source: "ai" | "template"; draft(r: ReviewForDraft): Promise<string> }

const firstName = (a: string | null): string => { const t = (a ?? "").trim().split(/\s+/)[0] ?? ""; return /^[\p{L}][\p{L}'.-]{0,30}$/u.test(t) ? t : ""; };

/** Neutral, brand-free wording by rating. The owner edits it before it goes anywhere. */
export const templateDrafter: ReplyDrafter = {
  source: "template",
  async draft(r) {
    const n = firstName(r.author), hi = n ? `, ${n}` : "";
    if (r.rating >= 4) return `Thank you for your kind words${hi}. We are glad you had a good experience and look forward to seeing you again.`;
    if (r.rating === 3) return `Thank you for your feedback${hi}. We would like to do better. Please contact us directly so we can hear more and put things right.`;
    return `Thank you for telling us${hi}. We are sorry your experience fell short of what it should be. Please contact us directly so we can make it right.`;
  },
};

/** Trims, strips control characters and enforces the stored limit. Empty after cleaning = null (nothing to approve). */
export function cleanReplyText(s: string): string | null {
  const t = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return t && t.length <= MAX_REPLY_LEN ? t : null;
}
