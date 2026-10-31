// @mentions are stored in the body as @[Display Name](user:<uuid>) so the text stays readable and ids are exact.
import { MAX_MENTIONS, type Mentionable } from "./types";

const TOKEN = /@\[([^\]\n]{1,80})\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export const mentionToken = (m: Mentionable) => `@[${m.name.replace(/[\][()\n]/g, "")}](user:${m.id})`;
export function extractMentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(TOKEN)].map((m) => m[2].toLowerCase()))].slice(0, MAX_MENTIONS + 1);
}
/** "Ask @[Priya](user:...) to call" -> "Ask @Priya to call" (notification text, search, email). */
export const plainBody = (body: string) => body.replace(TOKEN, (_m, name: string) => `@${name}`);

export type BodyPart = { t: "text"; v: string } | { t: "mention"; v: string; id: string };
/** Split body into text and mention parts for rendering without dangerouslySetInnerHTML. */
export function bodyParts(body: string): BodyPart[] {
  const out: BodyPart[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: body.slice(last, at) });
    out.push({ t: "mention", v: `@${m[1]}`, id: m[2].toLowerCase() });
    last = at + m[0].length;
  }
  if (last < body.length) out.push({ t: "text", v: body.slice(last) });
  return out;
}

export interface MentionCheck { ok: boolean; rejected: string[]; tooMany: boolean }
/** `readable` = ids the server has verified can read the record (authz.user_can_read). Everyone else is rejected. */
export function checkMentions(ids: string[], readable: ReadonlySet<string>, authorId: string): MentionCheck {
  const rejected = ids.filter((id) => id !== authorId && !readable.has(id));
  const tooMany = ids.length > MAX_MENTIONS;
  return { ok: rejected.length === 0 && !tooMany, rejected, tooMany };
}
