"use client";
// Realtime hooks (CONTRACTS C12 plus live list/record). All of them are inert outside a RealtimeProvider and, by default, never
// join: the caller passes `authorize` (true from the server's assertCan read, or an async check) and only then does a channel exist.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeContext } from "./context";
import { detectConflict, mergedPatch, type Choice, type Conflict, type Fields } from "./merge";
import { createLiveController, patchRows } from "./live";
import { parseChange, parseEditing } from "./presence";
import { tableTopic } from "./topics";
import type { ChangePayload, ConnectionState, EditingState, JoinOptions, Joined, PresenceUser } from "./types";

export type Authorize = boolean | (() => Promise<boolean>);
const toFn = (a: Authorize | undefined): (() => Promise<boolean>) => (typeof a === "function" ? a : async () => a === true);

interface JoinHandlers { presence?: boolean; onPresence?: (u: PresenceUser[]) => void; onEvent?: (e: string, p: unknown) => void; onResync?: () => void }

/** Join `topic` after `authorize`, leave on unmount or when inputs change. Returns a ref to the joined handle (for send). */
function useJoin(topic: string | null, authorize: Authorize | undefined, h: JoinHandlers) {
  const ctx = useRealtimeContext();
  const hub = ctx?.hub ?? null;
  const joined = useRef<Joined | null>(null);
  const hRef = useRef(h);
  hRef.current = h;
  const authRef = useRef(authorize);
  authRef.current = authorize;
  const allowed = authorize === true || typeof authorize === "function";
  useEffect(() => {
    if (!hub || !topic || !allowed) return;
    let cancelled = false, handle: Joined | null = null;
    const opts: JoinOptions = {
      authorize: toFn(authRef.current),
      presence: !!h.presence,
      onPresence: (u) => hRef.current.onPresence?.(u),
      onEvent: (e, p) => hRef.current.onEvent?.(e, p),
      onResync: () => hRef.current.onResync?.(),
    };
    void hub.join(topic, opts).then((j) => {
      if (cancelled) { j?.leave(); return; }
      handle = j; joined.current = j;
    });
    return () => { cancelled = true; handle?.leave(); joined.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, topic, allowed, h.presence]);
  return joined;
}

export function useConnectionState(): ConnectionState { return useRealtimeContext()?.state ?? "live"; }

/** Others present on a record or board topic (never yourself). Empty until authorized and joined. */
export function usePresence(topic: string | null, o: { authorize?: Authorize } = {}): PresenceUser[] {
  const ctx = useRealtimeContext();
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const me = ctx?.me.id;
  useJoin(topic, o.authorize, { presence: true, onPresence: setUsers });
  useEffect(() => { if (!topic) setUsers([]); }, [topic]);
  return useMemo(() => users.filter((u) => u.userId !== me), [users, me]);
}

const EDIT_TTL_MS = 20000, EDIT_RESEND_MS = 5000;
export interface Editor extends EditingState { name: string }
/** Typing/editing indicator: who is editing which field, and announce(field | null) for your own focus. Client broadcast "editing". */
export function useEditing(topic: string | null, o: { authorize?: Authorize } = {}): { editors: Editor[]; announce: (field: string | null) => void } {
  const ctx = useRealtimeContext();
  const me = ctx?.me.id;
  const [people, setPeople] = useState<PresenceUser[]>([]);
  const [raw, setRaw] = useState<Array<EditingState & { at: number }>>([]);
  const last = useRef<{ field: string | null; at: number }>({ field: null, at: 0 });
  const handle = useJoin(topic, o.authorize, {
    presence: true,
    onPresence: setPeople,
    onEvent: (event, payload) => {
      if (event !== "editing") return;
      const e = parseEditing(payload);
      if (!e || e.userId === me) return;
      setRaw((prev) => [...prev.filter((x) => x.userId !== e.userId), ...(e.field ? [{ ...e, at: Date.now() }] : [])]);
    },
  });
  // Expire stale entries: a peer who closed the tab never sends "stopped".
  useEffect(() => {
    if (raw.length === 0) return;
    const t = setInterval(() => setRaw((p) => p.filter((x) => Date.now() - x.at < EDIT_TTL_MS)), 5000);
    return () => clearInterval(t);
  }, [raw.length]);
  const editors = useMemo(() => raw.flatMap((e) => { const p = people.find((x) => x.userId === e.userId); return p ? [{ userId: e.userId, field: e.field, name: p.name }] : []; }), [raw, people]);
  const announce = useCallback((field: string | null) => {
    const now = Date.now();
    if (last.current.field === field && field !== null && now - last.current.at < EDIT_RESEND_MS) return;
    last.current = { field, at: now };
    handle.current?.send("editing", { userId: me ?? "", field });
  }, [handle, me]);
  useEffect(() => () => { if (last.current.field) handle.current?.send("editing", { userId: me ?? "", field: null }); }, [handle, me]);
  return { editors, announce };
}

/** Id-only change notifications for a table. The payload is parsed to {id, op, version, changedBy, changedFields}; refetch through the repositories. */
export function useTableChanges(table: string, onChange: (p: ChangePayload) => void, o: { authorize?: Authorize } = {}): void {
  const ctx = useRealtimeContext();
  const topic = ctx ? tableTopic(ctx.wsId, table) : null;
  const cb = useRef(onChange);
  cb.current = onChange;
  useJoin(topic, o.authorize, { onEvent: (_e, payload) => { const p = parseChange(payload); if (p) cb.current(p); } });
}

export interface LiveListOptions<T> {
  table: string;
  rows: readonly T[];
  idOf: (r: T) => string;
  /** Load the changed ids through a server action that calls the repositories (RLS applies). Omit ids you cannot read: they are dropped from the list. */
  loadByIds: (ids: string[]) => Promise<T[]>;
  /** Full reload after a reconnect, when broadcasts may have been missed. */
  reloadAll?: () => Promise<T[]>;
  authorize?: Authorize;
  /** True while the user has an edit open (drag, inline edit, open form): changes are held behind "N changes, refresh". */
  editing?: boolean;
  /** How long ids stay in `remoteChanged` (for the one motion that matters: a colleague moved a card). */
  highlightMs?: number;
}
export interface LiveList<T> { rows: T[]; pending: number; refresh: () => Promise<void>; remoteChanged: ReadonlySet<string> }

export function useLiveList<T>(o: LiveListOptions<T>): LiveList<T> {
  const ctx = useRealtimeContext();
  const [rows, setRows] = useState<T[]>(() => [...o.rows]);
  const [pending, setPending] = useState(0);
  const [remote, setRemote] = useState<ReadonlySet<string>>(new Set());
  const ref = useRef(o);
  ref.current = o;
  const editingRef = useRef(!!o.editing);
  editingRef.current = !!o.editing;
  useEffect(() => { setRows([...o.rows]); }, [o.rows]);

  const ctl = useMemo(() => createLiveController({
    me: ctx?.me.id,
    isEditing: () => editingRef.current,
    onPending: setPending,
    refetch: async (ids, { byOther }) => {
      const got = await ref.current.loadByIds(ids);
      setRows((cur) => patchRows(cur, got, ids, ref.current.idOf));
      setRemote(byOther);
      setTimeout(() => setRemote(new Set()), ref.current.highlightMs ?? 1200);
    },
  }), [ctx?.me.id]);
  useEffect(() => () => ctl.dispose(), [ctl]);
  useEffect(() => { if (!o.editing) ctl.editingEnded(); }, [o.editing, ctl]);

  const topic = ctx ? tableTopic(ctx.wsId, o.table) : null;
  useJoin(topic, o.authorize, {
    onEvent: (_e, p) => ctl.push(p),
    onResync: () => { const all = ref.current.reloadAll; if (all) void all().then((r) => setRows(r)); },
  });
  return { rows, pending, refresh: ctl.flush, remoteChanged: remote };
}

export interface LiveRecordOptions<T extends Fields & { id: string; version: number }> {
  table: string;
  initial: T;
  load: (id: string) => Promise<T | null>;
  /** Your unsaved edits (field -> value), or null when not editing. */
  draft: Fields | null;
  authorize?: Authorize;
}
export interface LiveRecord<T> {
  record: T;
  /** Set when a colleague saved a record you are editing and your draft is at risk. */
  conflict: Conflict | null;
  /** Colleague saved but you are not editing: the record was already patched in place. */
  updatedByOther: boolean;
  /** Merge: returns the patch to save with expectedVersion, and adopts their row as the new base. */
  merge: (choices?: Record<string, Choice>) => { patch: Fields; expectedVersion: number } | null;
  /** Discard your edits and take their row. */
  discard: () => void;
}

export function useLiveRecord<T extends Fields & { id: string; version: number }>(o: LiveRecordOptions<T>): LiveRecord<T> {
  const ctx = useRealtimeContext();
  const [record, setRecord] = useState<T>(o.initial);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [updatedByOther, setUpdated] = useState(false);
  const recRef = useRef(record); recRef.current = record;
  const ref = useRef(o); ref.current = o;
  useEffect(() => { setRecord(o.initial); setConflict(null); }, [o.initial]);

  const onChange = useCallback(async (raw: unknown) => {
    const p = parseChange(raw);
    const cur = recRef.current;
    if (!p || p.id !== cur.id || (ctx?.me.id && p.changedBy === ctx.me.id)) return;
    if (p.version != null && p.version <= cur.version) return;
    const next = await ref.current.load(cur.id); // fetched through the repository: RLS decides what we may see
    if (!next || next.version <= recRef.current.version) return;
    const draft = ref.current.draft;
    if (draft && Object.keys(draft).length > 0) {
      const c = detectConflict(recRef.current, draft, next, p.changedBy);
      if (c) { setConflict(c); return; }
    }
    setRecord(next); setUpdated(true);
  }, [ctx?.me.id]);

  const topic = ctx ? tableTopic(ctx.wsId, o.table) : null;
  useJoin(topic, o.authorize, { onEvent: (_e, p) => { void onChange(p); } });

  const merge = useCallback((choices?: Record<string, Choice>) => {
    if (!conflict) return null;
    const patch = mergedPatch(conflict, choices);
    setRecord(conflict.theirs as T); setConflict(null);
    return { patch, expectedVersion: conflict.theirsVersion };
  }, [conflict]);
  const discard = useCallback(() => { if (conflict) { setRecord(conflict.theirs as T); setConflict(null); } }, [conflict]);
  return { record, conflict, updatedByOther, merge, discard };
}
