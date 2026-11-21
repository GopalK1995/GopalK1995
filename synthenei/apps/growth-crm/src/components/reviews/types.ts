// View types for the reviews components. Plain data: the page builds these from the `reviews` rows.
export type ReplyStatusKey = "none" | "draft" | "pending_approval" | "approved" | "posted" | "failed";
export interface ReviewView {
  id: string; rating: number | null; author: string | null; text: string | null; reviewedAt: string | null;
  replyDraft: string | null; replyStatus: ReplyStatusKey; replySource: "ai" | "template" | "human" | null;
  /** A reply already on Google that was not written here (read-only hint). */
  externalReply: string | null;
}
export type ActionResult = { ok: boolean; code?: string };
/** Server actions supplied by the page; each re-checks permission and state on the server. */
export interface ReviewActions {
  draft(id: string, text?: string): Promise<ActionResult>;
  submit(id: string): Promise<ActionResult>;
  decide(id: string, decision: "approve" | "reject"): Promise<ActionResult>;
  post(id: string): Promise<ActionResult>;
}
