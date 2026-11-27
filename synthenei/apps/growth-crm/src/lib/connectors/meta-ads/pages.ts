// AUD-100: one Meta connection (one Facebook Login) can track several Pages, each with its linked Instagram account. The credential
// bundle holds them as `pages_json`; the legacy single-page keys (page_id / page_token / ig_user_id) always mirror the FIRST page so a
// bundle saved before this change reads as "one page" without any migration or re-authorisation. Page tokens derived from a long-lived
// user token do not expire. Pure helpers, safe in any bundle.
import type { ConnectionSecrets } from "../core/types";
import { CRED } from "./constants";

export interface PageEntry { id: string; token: string; igUserId?: string; name?: string; igUsername?: string }

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** Every Page of the connection, primary first. A bundle without `pages_json` yields its single legacy page; a corrupt list falls back to it too. */
export function pagesOf(secrets: ConnectionSecrets): PageEntry[] {
  const out: PageEntry[] = [];
  const raw = secrets[CRED.pages];
  if (raw) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (Array.isArray(v)) {
        for (const x of v) {
          if (!x || typeof x !== "object") continue;
          const o = x as Record<string, unknown>, id = text(o.id, 64), token = text(o.token, 4000);
          if (!id || !token || out.some((p) => p.id === id)) continue;
          out.push({ id, token, igUserId: text(o.igUserId, 64), name: text(o.name, 200), igUsername: text(o.igUsername, 100) });
        }
      }
    } catch { /* fall back to the legacy keys */ }
  }
  const legacyId = secrets[CRED.pageId], legacyToken = secrets[CRED.pageToken] ?? "";
  if (legacyId && !out.some((p) => p.id === legacyId)) out.unshift({ id: legacyId, token: legacyToken, igUserId: secrets[CRED.igUserId] || undefined });
  return out;
}

/** The bundle with `pages` stored and the legacy keys mirroring pages[0] (removed when the list is empty). Other keys are untouched. */
export function withPages(secrets: ConnectionSecrets, pages: PageEntry[]): ConnectionSecrets {
  const next: ConnectionSecrets = { ...secrets };
  delete next[CRED.pages]; delete next[CRED.pageId]; delete next[CRED.pageToken]; delete next[CRED.igUserId];
  const first = pages[0];
  if (!first) return next;
  next[CRED.pages] = JSON.stringify(pages.map((p) => ({ id: p.id, token: p.token, ...(p.igUserId ? { igUserId: p.igUserId } : {}), ...(p.name ? { name: p.name } : {}), ...(p.igUsername ? { igUsername: p.igUsername } : {}) })));
  next[CRED.pageId] = first.id; next[CRED.pageToken] = first.token;
  if (first.igUserId) next[CRED.igUserId] = first.igUserId;
  return next;
}

/** The bundle as the single-page code expects it, for one Page: its id, token and Instagram id replace the primary's. */
export function secretsForPage(secrets: ConnectionSecrets, pageId: string): ConnectionSecrets | null {
  const p = pagesOf(secrets).find((x) => x.id === pageId);
  return p ? withPageKeys(secrets, p) : null;
}
export function secretsForInstagram(secrets: ConnectionSecrets, igUserId: string): ConnectionSecrets | null {
  const p = pagesOf(secrets).find((x) => x.igUserId === igUserId);
  return p ? withPageKeys(secrets, p) : null;
}
function withPageKeys(secrets: ConnectionSecrets, p: PageEntry): ConnectionSecrets {
  const next: ConnectionSecrets = { ...secrets, [CRED.pageId]: p.id, [CRED.pageToken]: p.token };
  if (p.igUserId) next[CRED.igUserId] = p.igUserId; else delete next[CRED.igUserId];
  return next;
}

export const ownsPageId = (secrets: ConnectionSecrets, pageId: string): boolean => !!pageId && pagesOf(secrets).some((p) => p.id === pageId);
export const ownsIgId = (secrets: ConnectionSecrets, igUserId: string): boolean => !!igUserId && (secrets[CRED.igUserId] === igUserId || pagesOf(secrets).some((p) => p.igUserId === igUserId));
