// Block Kit builder for CRM alerts. Pure. Every piece of text that came from data goes through `mrkdwn()` (escapes &, <, > so a lead
// name cannot inject a Slack mention or link) and is clipped to Slack's limits, so a hostile or huge value can never make Slack reject
// the message (which would silently lose the alert).
import { LIMITS } from "./constants";

export type Block = Record<string, unknown>;
export interface AlertField { label: string; value: string }
export interface AlertView {
  /** Plain-text headline: the notification text and the header block. */
  title: string;
  fields?: AlertField[];
  context?: string;
  /** Absolute https URL of the CRM record. */
  url?: string | null;
  buttonLabel?: string;
}
export interface SlackMessage { text: string; blocks: Block[] }

export const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`);
/** Escapes Slack control characters in untrusted text (https://api.slack.com/reference/surfaces/formatting#escaping). */
export const mrkdwn = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Plain text for headers, buttons and the fallback `text` (which Slack parses as mrkdwn): control characters and newlines flattened, and
 *  angle brackets swapped for look-alikes so `<!channel>`, `<@U1>` or `<https://x|y>` can never be formed from data. */
export const plain = (s: string, max: number): string => clip(s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/</g, "‹").replace(/>/g, "›").replace(/\s+/g, " ").trim(), max);

export const isHttpsUrl = (u: string | null | undefined): u is string => {
  if (!u || u.length > LIMITS.buttonUrl) return false;
  try { return new URL(u).protocol === "https:"; } catch { return false; }
};

export const headerBlock = (text: string): Block => ({ type: "header", text: { type: "plain_text", text: plain(text, LIMITS.headerText) || "-", emoji: false } });
export const sectionBlock = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text: clip(text, LIMITS.sectionText) } });
export const fieldsBlock = (fields: AlertField[]): Block => ({
  type: "section",
  fields: fields.slice(0, LIMITS.fields).map((f) => ({ type: "mrkdwn", text: clip(`*${mrkdwn(plain(f.label, 60))}*\n${mrkdwn(f.value) || "-"}`, LIMITS.fieldText) })),
});
export const contextBlock = (text: string): Block => ({ type: "context", elements: [{ type: "mrkdwn", text: clip(mrkdwn(text), LIMITS.sectionText) }] });
export const linkButtonBlock = (label: string, url: string): Block => ({
  type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: plain(label, LIMITS.buttonText) || "Open", emoji: false }, url }],
});

export function buildAlertMessage(v: AlertView): SlackMessage {
  const blocks: Block[] = [headerBlock(v.title)];
  const fields = (v.fields ?? []).filter((f) => f.value.trim() !== "");
  if (fields.length) blocks.push(fieldsBlock(fields));
  if (v.context) blocks.push(contextBlock(v.context));
  if (isHttpsUrl(v.url)) blocks.push(linkButtonBlock(v.buttonLabel ?? "Open", v.url));
  return { text: plain(v.title, LIMITS.fallbackText) || "-", blocks: blocks.slice(0, LIMITS.blocks) };
}
