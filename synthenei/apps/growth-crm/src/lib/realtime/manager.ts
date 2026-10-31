// RealtimeManager: private channel joins for one workspace, with reconnect backoff, token refresh, visibility handling and
// an aggregate connection state. Pure TypeScript over a RealtimeTransport so it is unit-testable with a fake channel.
import { backoffDelay } from "./backoff";
import { presencePayload, usersFromState } from "./presence";
import { topicInWorkspace } from "./topics";
import type { ChannelLike, ConnectionState, Identity, JoinOptions, Joined, PresenceUser, RealtimeHub, RealtimeTransport } from "./types";

export interface ManagerOptions {
  transport: RealtimeTransport;
  wsId: string;
  me: Identity;
  /** Attach window online/offline and document visibility listeners. Off in unit tests. */
  listen?: boolean;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** After this many consecutive failed joins on a channel the state reads "offline" (it keeps retrying at the cap). */
  offlineAfter?: number;
  /** Backgrounded longer than this: ask hooks to refetch on return, broadcasts may have been missed. */
  resyncAfterHiddenMs?: number;
}

type Status = "joining" | "subscribed" | "retrying";
/** One channel per topic, shared by every subscriber that joined it (presence faces + editing indicator on the same record). */
interface Entry {
  topic: string; subs: Set<JoinOptions>; ch: ChannelLike | null; status: Status; attempt: number; hadFailure: boolean; left: boolean; timer: unknown;
  tracking: boolean; users: PresenceUser[] | null;
}

export class RealtimeManager implements RealtimeHub {
  readonly demo = false;
  private entries = new Map<string, Entry>();
  private listeners = new Set<(s: ConnectionState) => void>();
  private state: ConnectionState = "live";
  private online = true;
  private hiddenAt: number | null = null;
  private disposed = false;
  private unsub: Array<() => void> = [];
  private o: Required<Pick<ManagerOptions, "baseDelayMs" | "maxDelayMs" | "offlineAfter" | "resyncAfterHiddenMs">> & ManagerOptions;

  constructor(opts: ManagerOptions) {
    this.o = { baseDelayMs: 1000, maxDelayMs: 30000, offlineAfter: 5, resyncAfterHiddenMs: 30000, ...opts };
    if (opts.transport.onAuthChange) this.unsub.push(opts.transport.onAuthChange(() => { void this.refreshAuth(); }));
    if (opts.listen && typeof window !== "undefined") {
      const on = () => this.handleOnline(), off = () => this.handleOffline(), vis = () => (document.visibilityState === "visible" ? this.handleVisible() : this.handleHidden());
      this.online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
      window.addEventListener("online", on); window.addEventListener("offline", off); document.addEventListener("visibilitychange", vis);
      this.unsub.push(() => { window.removeEventListener("online", on); window.removeEventListener("offline", off); document.removeEventListener("visibilitychange", vis); });
    }
    this.recompute();
  }

  getState(): ConnectionState { return this.state; }
  onState(cb: (s: ConnectionState) => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  /** Number of open or pending channels, for leak checks. */
  channelCount(): number { return this.entries.size; }

  async join(topic: string, opts: JoinOptions): Promise<Joined | null> {
    if (this.disposed || !topicInWorkspace(topic, this.o.wsId)) return null;
    // Authorization first: no channel exists for a record or board the viewer cannot read, so presence never reveals it.
    let ok = false;
    try { ok = await opts.authorize(); } catch { ok = false; }
    if (!ok || this.disposed) return null;
    let e = this.entries.get(topic);
    if (!e) {
      e = { topic, subs: new Set(), ch: null, status: "joining", attempt: 0, hadFailure: false, left: false, timer: null, tracking: false, users: null };
      this.entries.set(topic, e);
      e.subs.add(opts);
      void this.open(e);
    } else {
      e.subs.add(opts);
      if (opts.presence) { this.syncTracking(e); if (e.users) opts.onPresence?.(e.users); }
    }
    const entry = e;
    return {
      topic,
      leave: () => this.unsubscribe(entry, opts),
      send: (event, payload) => { if (entry.ch && entry.status === "subscribed") void Promise.resolve(entry.ch.send({ type: "broadcast", event, payload })).catch(() => undefined); },
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const e of [...this.entries.values()]) this.leave(e);
    for (const u of this.unsub.splice(0)) u();
    this.listeners.clear();
  }

  handleOffline(): void { this.online = false; this.recompute(); }
  handleOnline(): void { this.online = true; this.reconnectNow(); this.recompute(); }
  handleHidden(): void { this.hiddenAt = this.now(); }
  handleVisible(): void {
    const away = this.hiddenAt == null ? 0 : this.now() - this.hiddenAt;
    this.hiddenAt = null;
    if (!this.reconnectNow() && away >= this.o.resyncAfterHiddenMs) for (const e of this.entries.values()) for (const sub of e.subs) sub.onResync?.();
  }

  private now(): number { return (this.o.now ?? Date.now)(); }
  private async refreshAuth(): Promise<void> { try { await this.o.transport.setAuth(); } catch { /* next join retries */ } }

  /** Retry every failed channel immediately with a fresh backoff. Returns true when anything was waiting. */
  private reconnectNow(): boolean {
    let any = false;
    for (const e of this.entries.values()) if (e.status === "retrying") {
      any = true; this.clear(e.timer); e.timer = null; e.attempt = 0; void this.open(e);
    }
    return any;
  }

  private async open(e: Entry): Promise<void> {
    if (e.left || this.disposed) return;
    e.status = "joining"; this.recompute();
    try { await this.o.transport.setAuth(); } catch { this.fail(e); return; }
    if (e.left || this.disposed) return;
    const ch = this.o.transport.channel(e.topic, { private: true, presenceKey: this.o.me.id });
    e.ch = ch;
    ch.on("presence", { event: "sync" }, () => {
      if (e.ch !== ch) return;
      e.users = usersFromState(ch.presenceState());
      for (const sub of e.subs) if (sub.presence) sub.onPresence?.(e.users);
    });
    ch.on("broadcast", { event: "*" }, (m: { event?: string; payload?: unknown }) => {
      if (e.ch === ch && typeof m?.event === "string") for (const sub of [...e.subs]) sub.onEvent?.(m.event, m.payload);
    });
    ch.subscribe((status) => {
      if (e.ch !== ch || e.left) return;
      if (status === "SUBSCRIBED") {
        const recovered = e.hadFailure;
        e.status = "subscribed"; e.attempt = 0; e.hadFailure = false;
        e.tracking = false;
        this.syncTracking(e);
        this.recompute();
        if (recovered) for (const sub of [...e.subs]) sub.onResync?.();
      } else if (status === "TIMED_OUT" || status === "CHANNEL_ERROR" || status === "CLOSED") this.fail(e);
    });
  }

  private fail(e: Entry): void {
    if (e.left || this.disposed) return;
    this.detach(e);
    e.hadFailure = true; e.status = "retrying";
    const delay = backoffDelay(e.attempt, { base: this.o.baseDelayMs, max: this.o.maxDelayMs, random: this.o.random });
    e.attempt += 1;
    this.clear(e.timer);
    e.timer = this.timer(() => { e.timer = null; void this.open(e); }, delay);
    this.recompute();
  }

  private detach(e: Entry): void {
    const ch = e.ch; e.ch = null;
    if (ch) void Promise.resolve(this.o.transport.removeChannel(ch)).catch(() => undefined);
  }

  /** Track our presence while at least one subscriber wants it; untrack when the last one leaves. */
  private syncTracking(e: Entry): void {
    const ch = e.ch;
    if (!ch || e.status !== "subscribed") return;
    const want = [...e.subs].some((x) => x.presence);
    if (want && !e.tracking) { e.tracking = true; void Promise.resolve(ch.track(presencePayload(this.o.me, this.now()))).catch(() => undefined); }
    else if (!want && e.tracking) { e.tracking = false; void Promise.resolve(ch.untrack()).catch(() => undefined); }
  }

  private unsubscribe(e: Entry, opts: JoinOptions): void {
    if (!e.subs.delete(opts)) return;
    if (e.subs.size === 0) this.leave(e); else this.syncTracking(e);
  }

  private leave(e: Entry): void {
    if (e.left) return;
    e.left = true; this.clear(e.timer); e.timer = null; e.subs.clear();
    const ch = e.ch;
    if (ch && e.tracking) void Promise.resolve(ch.untrack()).catch(() => undefined);
    this.detach(e);
    this.entries.delete(e.topic);
    this.recompute();
  }

  private timer(fn: () => void, ms: number): unknown { return (this.o.setTimer ?? ((f, t) => setTimeout(f, t)))(fn, ms); }
  private clear(h: unknown): void { if (h != null) (this.o.clearTimer ?? ((x) => clearTimeout(x as ReturnType<typeof setTimeout>)))(h); }

  private recompute(): void {
    let next: ConnectionState = "live";
    if (!this.online) next = "offline";
    else {
      for (const e of this.entries.values()) if (e.status === "retrying" || (e.status === "joining" && e.hadFailure)) {
        next = e.attempt >= this.o.offlineAfter ? "offline" : next === "offline" ? "offline" : "reconnecting";
      }
    }
    if (next !== this.state) { this.state = next; for (const cb of [...this.listeners]) cb(next); }
  }
}
