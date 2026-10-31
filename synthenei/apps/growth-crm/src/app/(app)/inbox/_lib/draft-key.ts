/** localStorage key for a per-user composer draft. Workspace + user + conversation: nothing is shared across tenants or people.
 *  Kept apart from drafts.ts so the client bundle never imports the Tamil sample drafts. */
export const draftKey = (ws: string, uid: string, convId: string) => `inbox.draft.v1:${ws}:${uid}:${convId}`;
