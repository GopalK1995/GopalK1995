// Types shared by the fetcher (server only) and the sync code (pure): a failed fetch has a short machine code, nothing else.
export type FetchErrorCode = "bad_url" | "blocked_address" | "dns" | "timeout" | "too_large" | "too_many_redirects" | "connect" | "bad_redirect";
export class FeedFetchError extends Error { constructor(public code: FetchErrorCode) { super(code); this.name = "FeedFetchError"; } }
export interface FeedResponse { status: number; body: string }
/** The seam the sync code uses; tests pass a scripted one. */
export type FeedFetcher = (url: string) => Promise<FeedResponse>;
