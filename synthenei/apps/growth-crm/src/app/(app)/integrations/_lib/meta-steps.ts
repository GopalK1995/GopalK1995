// The "Connect Instagram and Facebook" step list (AUD-119). Pure: turns what the page loaded (connection, chosen Page, health, last sync)
// into plain, already-translated text and a real completion state per step. Nothing here holds a token or a secret.
import { fmtDateTime, fmtDateY } from "@/lib/format";
import type { T } from "./strings";
import type { MetaConnectView, MetaHealthView } from "./types";

export type StepStatus = "done" | "todo" | "attention" | "blocked" | "pending";
export interface StepLine { text: string; bad?: boolean }
export interface StepModel { key: "connect" | "assets" | "webhooks" | "sync"; n: number; title: string; status: StepStatus; statusLabel: string; lines: StepLine[] }
export interface ScopeItem { name: string; state: "granted" | "missing" | "unknown"; label: string }
export interface MetaConnectModel {
  next: { text: string; tone: "ok" | "action" | "warn" };
  steps: StepModel[];
  scopes: ScopeItem[];
}

const SOON_DAYS = 7;

/** The one thing the owner should do now, in priority order. */
function nextLine(c: MetaConnectView, h: MetaHealthView | null, t: T, connectBlocked: string | null): MetaConnectModel["next"] {
  if (!c.connected) return connectBlocked ? { tone: "warn", text: t("metaSteps.next.blocked", { reason: connectBlocked }) } : { tone: "action", text: t("metaSteps.next.connect") };
  if (c.needsReconnect || (h?.daysLeft != null && h.daysLeft < 0)) return { tone: "warn", text: t("metaSteps.next.reconnect") };
  if (h && h.scopesMissing.length) return { tone: "warn", text: t("metaSteps.next.scopes", { list: h.scopesMissing.join(", ") }) };
  if (h?.daysLeft != null && h.daysLeft < SOON_DAYS) return { tone: "warn", text: t("metaSteps.next.renew", { days: h.daysLeft }) };
  if (!c.pageName) return { tone: "action", text: t("metaSteps.next.choose") };
  if (!h?.lastOkAt) return { tone: "action", text: t("metaSteps.next.sync") };
  if (h.webhook === "yes") return { tone: "ok", text: t("metaSteps.next.done") };
  return { tone: "ok", text: t("metaSteps.next.webhooks") };
}

export function buildMetaConnectModel({ c, h, t, connectBlocked }: { c: MetaConnectView; h: MetaHealthView | null; t: T; connectBlocked: string | null }): MetaConnectModel {
  const label = (s: StepStatus) => t(`metaSteps.status.${s}`);
  const expired = h?.daysLeft != null && h.daysLeft < 0;

  // 1. Connect Facebook: done only while the connection is healthy (credentials exist, nothing missing, not expired).
  const s1: StepStatus = !c.connected ? "todo" : c.needsReconnect || expired || (h?.scopesMissing.length ?? 0) > 0 ? "attention" : "done";
  const l1: StepLine[] = [{ text: t(s1 === "todo" ? "metaSteps.s1.todo" : s1 === "attention" ? "metaSteps.s1.attention" : "metaSteps.s1.done"), bad: s1 === "attention" }];
  if (c.connected && h) {
    l1.push(h.scopesGranted === null ? { text: t("metaSteps.s1.scopesUnknown") } : { text: t("metaSteps.s1.scopes", { granted: h.scopesGranted, requested: h.scopesRequested }), bad: h.scopesMissing.length > 0 });
    if (h.expiresAt) {
      const date = fmtDateY(h.expiresAt);
      l1.push(expired ? { text: t("metaSteps.s1.expired", { date }), bad: true } : { text: t("metaSteps.s1.expires", { date, days: h.daysLeft ?? "" }), bad: h.daysLeft != null && h.daysLeft < SOON_DAYS });
    } else l1.push({ text: t(h.neverExpires ? "metaSteps.s1.noExpiry" : "metaSteps.s1.expiryUnknown") });
  }

  // 2. Page and Instagram account: done when a Page is stored on the connection.
  const s2: StepStatus = !c.connected ? "blocked" : c.pageName ? "done" : "todo";
  const l2: StepLine[] = [];
  if (s2 === "blocked") l2.push({ text: t("metaSteps.s2.blocked") });
  else if (c.pageName) {
    l2.push({ text: t("metaSteps.s2.page", { name: c.pageName }) });
    l2.push({ text: c.igUsername ? t("metaSteps.s2.ig", { name: c.igUsername.replace(/^@/, "") }) : t("metaSteps.s2.noIg") });
    l2.push({ text: t("metaSteps.s2.oneOnly") });
  } else l2.push({ text: t("metaSteps.s2.todo") }, { text: t("metaSteps.s2.oneOnly") });

  // 3. Webhooks: the platform endpoint (AUD-065) is not live yet, so this step is honestly "pending platform setup". The Page
  // subscription fact is real (recorded by the asset selection) and is shown beside it.
  const l3: StepLine[] = [{ text: t("metaSteps.s3.pending") }];
  if (c.connected && h) l3.push(h.webhook === "yes" ? { text: t("metaSteps.s3.subscribed") } : h.webhook === "no" ? { text: t("metaSteps.s3.notSubscribed"), bad: true } : { text: t("metaSteps.s3.unknown") });
  l3.push({ text: t("metaSteps.s3.fallback") });

  // 4. First sync: done when a run really imported something.
  const s4: StepStatus = !c.pageName ? "blocked" : h?.lastOkAt ? "done" : "todo";
  const l4: StepLine[] = [];
  if (s4 === "blocked") l4.push({ text: t("metaSteps.s4.blocked") });
  else if (h?.lastOkAt) {
    l4.push({ text: t("metaSteps.s4.done", { when: fmtDateTime(h.lastOkAt) }) });
    l4.push({ text: t("metaSteps.s4.counts", { accounts: c.accounts, posts: c.posts }) });
    if (c.lastOkRows !== null) l4.push({ text: t("metaSteps.s4.rows", { rows: c.lastOkRows }) });
  } else l4.push({ text: t("metaSteps.s4.waiting") });

  const granted = h?.scopesGrantedList ?? [];
  const scopes: ScopeItem[] = c.connected && h
    ? h.scopesRequestedList.map((name) => {
      const state: ScopeItem["state"] = granted.length === 0 ? "unknown" : granted.includes(name) ? "granted" : "missing";
      return { name, state, label: t(state === "granted" ? "metaSteps.scopeGranted" : state === "missing" ? "metaSteps.scopeMissing" : "metaSteps.scopeUnknown") };
    })
    : [];

  const mk = (key: StepModel["key"], n: number, status: StepStatus, lines: StepLine[]): StepModel => ({ key, n, title: t(`metaSteps.s${n}.title`), status, statusLabel: label(status), lines });
  return {
    next: nextLine(c, h, t, connectBlocked),
    steps: [mk("connect", 1, s1, l1), mk("assets", 2, s2, l2), mk("webhooks", 3, "pending", l3), mk("sync", 4, s4, l4)],
    scopes,
  };
}
