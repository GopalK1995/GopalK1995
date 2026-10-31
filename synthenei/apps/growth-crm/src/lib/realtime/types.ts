// Realtime types (CONTRACTS C12, BUILD-PLAN 1.5). Channels are private; broadcasts are id-only; presence carries a display name and an avatar colour only.
export type ConnectionState = "live" | "reconnecting" | "offline";

export type ChangeOp = "INSERT" | "UPDATE" | "DELETE";
/** Id-only row-change payload sent by the DB trigger. Never contains row data. */
export interface ChangePayload { id: string; op: ChangeOp; version: number | null; changedBy: string | null; changedFields: string[] }

/** Avatar colour is a token slot, never a CSS value, so a hostile peer cannot inject styles. */
export const PRESENCE_COLORS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
export type PresenceColor = (typeof PRESENCE_COLORS)[number];

/** Everything a peer may learn about a viewer: opaque user id, display name, initials, colour token, join time. */
export interface PresenceUser { userId: string; name: string; initials: string; color: PresenceColor; at: number; sample?: boolean }
export interface Identity { id: string; name: string }
export interface EditingState { userId: string; field: string }

/** The slice of a Supabase RealtimeChannel the manager uses. */
export interface ChannelLike {
  on(type: "presence" | "broadcast", filter: { event: string }, cb: (msg: never) => void): ChannelLike;
  subscribe(cb?: (status: string, err?: unknown) => void): ChannelLike;
  track(payload: Record<string, unknown>): Promise<unknown>;
  untrack(): Promise<unknown>;
  presenceState(): Record<string, unknown[]>;
  send(msg: { type: "broadcast"; event: string; payload: Record<string, unknown> }): Promise<unknown>;
}
export interface ChannelOptions { private: true; presenceKey: string }
/** Transport seam: the Supabase wrapper in client.ts, or a fake in tests. */
export interface RealtimeTransport {
  channel(topic: string, opts: ChannelOptions): ChannelLike;
  removeChannel(ch: ChannelLike): Promise<unknown> | void;
  /** Push the current access token to the socket. Called before every (re)join and after a token refresh. */
  setAuth(): Promise<void>;
  onAuthChange?(cb: () => void): () => void;
}

export interface JoinOptions {
  /** Gate evaluated before any channel exists. Must resolve true only after the server-side assertCan read for this record or board. */
  authorize: () => Promise<boolean>;
  presence?: boolean;
  onPresence?: (users: PresenceUser[]) => void;
  onEvent?: (event: string, payload: unknown) => void;
  /** Fired after a reconnect or a tab returning to the foreground: broadcasts may have been missed, so refetch. */
  onResync?: () => void;
}
export interface Joined { topic: string; leave(): void; send(event: string, payload: Record<string, unknown>): void }

export interface RealtimeHub {
  readonly demo: boolean;
  getState(): ConnectionState;
  onState(cb: (s: ConnectionState) => void): () => void;
  join(topic: string, opts: JoinOptions): Promise<Joined | null>;
  dispose(): void;
}
