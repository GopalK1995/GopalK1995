// The seam between Gmail sync logic and Google. api.ts = Gmail API v1, mock.ts = Showcase (no network). Token per call (per-user grants).
import type { GThread } from "./matcher";

export interface GmailGateway {
  readonly kind: "api" | "mock";
  profile(token: string): Promise<{ email: string }>;
  /** Thread ids matching a Gmail search query. */
  listThreadIds(token: string, query: string, max: number): Promise<string[]>;
  getThread(token: string, id: string): Promise<GThread | null>;
  /** users.messages.send with a ready base64url RFC 2822 body, in an existing thread. Returns the new message id. */
  send(token: string, raw: string, threadId: string): Promise<{ id: string }>;
}
