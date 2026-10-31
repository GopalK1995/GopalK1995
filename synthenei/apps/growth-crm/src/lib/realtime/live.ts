// Live-update controller (framework free). Collects id-only change notifications, coalesces them, and asks the caller to refetch
// those ids through its repository-backed loader. It never reads row data from a payload. While the user is mid-edit it holds
// the refetch and reports a pending count instead ("N changes, refresh").
import { parseChange } from "./presence";

export interface LiveControllerOptions {
  /** Current user id; changes whose changed_by equals it are our own saves and are ignored. */
  me?: string | null;
  isEditing: () => boolean;
  /** Load the changed ids through the repositories. `byOther` are ids last changed by a colleague. */
  refetch: (ids: string[], info: { byOther: ReadonlySet<string> }) => Promise<void> | void;
  onPending?: (count: number) => void;
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export interface LiveController {
  /** Feed a raw broadcast payload. Invalid payloads are dropped. */
  push(raw: unknown): void;
  /** Refetch everything pending now (the "refresh" button, or after the edit ends). */
  flush(): Promise<void>;
  /** Call when editing stops: pending changes then load without a click. */
  editingEnded(): void;
  pendingCount(): number;
  dispose(): void;
}

export function createLiveController(o: LiveControllerOptions): LiveController {
  const pending = new Map<string, boolean>(); // id -> changed by someone else
  let timer: unknown = null, disposed = false;
  const set = o.setTimer ?? ((f, t) => setTimeout(f, t));
  const clear = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const stop = () => { if (timer != null) { clear(timer); timer = null; } };

  async function flush(): Promise<void> {
    stop();
    if (disposed || pending.size === 0) return;
    const ids = [...pending.keys()];
    const byOther = new Set(ids.filter((id) => pending.get(id)));
    pending.clear();
    o.onPending?.(0);
    await o.refetch(ids, { byOther });
  }
  function schedule() { stop(); timer = set(() => { timer = null; void flush(); }, o.debounceMs ?? 150); }

  return {
    push(raw) {
      if (disposed) return;
      const p = parseChange(raw);
      if (!p) return;
      if (o.me && p.changedBy === o.me) return;
      pending.set(p.id, true); // own saves were filtered above, so everything left is a colleague's (or unattributed) change
      if (o.isEditing()) { stop(); o.onPending?.(pending.size); } else schedule();
    },
    flush,
    editingEnded() { if (pending.size > 0) schedule(); },
    pendingCount: () => pending.size,
    dispose() { disposed = true; stop(); pending.clear(); },
  };
}

/** Merge refetched rows into a list in place: replace by id, append new, drop ids the loader no longer returns (deleted or no longer readable). */
export function patchRows<T>(rows: readonly T[], fetched: readonly T[], requested: readonly string[], idOf: (r: T) => string): T[] {
  const got = new Map(fetched.map((r) => [idOf(r), r]));
  const gone = new Set(requested.filter((id) => !got.has(id)));
  const next = rows.filter((r) => !gone.has(idOf(r))).map((r) => got.get(idOf(r)) ?? r);
  const have = new Set(next.map(idOf));
  for (const r of fetched) if (!have.has(idOf(r))) next.push(r);
  return next;
}
