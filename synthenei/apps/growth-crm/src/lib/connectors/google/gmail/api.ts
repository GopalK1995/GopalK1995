// Gmail API v1 client on the shared Google HTTP helper. Only `users/me` is used (the connected user's own mailbox).
import { googleJson, joinUrl, type GoogleHttpDeps } from "../shared/api";
import { GoogleApiError } from "../shared/errors";
import type { GmailGateway } from "./gateway";
import type { GThread } from "./matcher";

export interface GmailApiOpts extends GoogleHttpDeps { base: string }

export function makeGmailApi(o: GmailApiOpts): GmailGateway {
  const { base, ...deps } = o;
  const u = (p: string) => joinUrl(base, `users/me/${p}`);
  return {
    kind: "api",
    async profile(token) { const j = await googleJson<{ emailAddress?: string }>({ method: "GET", url: u("profile"), token }, deps); return { email: (j.emailAddress ?? "").toLowerCase() }; },
    async listThreadIds(token, query, max) {
      const out: string[] = [];
      let page: string | undefined;
      do {
        const q = new URLSearchParams({ q: query, maxResults: String(Math.min(100, max - out.length)), includeSpamTrash: "false" });
        if (page) q.set("pageToken", page);
        const j = await googleJson<{ threads?: { id: string }[]; nextPageToken?: string }>({ method: "GET", url: `${u("threads")}?${q}`, token }, deps);
        for (const t of j.threads ?? []) out.push(t.id);
        page = j.nextPageToken;
      } while (page && out.length < max);
      return out;
    },
    async getThread(token, id) {
      try { return await googleJson<GThread>({ method: "GET", url: `${u(`threads/${encodeURIComponent(id)}`)}?format=full`, token }, deps); }
      catch (e) { if (e instanceof GoogleApiError && e.httpStatus === 404) return null; throw e; }
    },
    async send(token, raw, threadId) { const j = await googleJson<{ id: string }>({ method: "POST", url: u("messages/send"), token, body: { raw, threadId } }, deps); return { id: j.id }; },
  };
}
