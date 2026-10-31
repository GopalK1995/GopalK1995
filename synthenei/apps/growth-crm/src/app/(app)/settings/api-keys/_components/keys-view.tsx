"use client";
// Key ledger: name, masked key, role, scopes, last used, expiry, status. Create opens a dialog; the new secret is shown once.
import { useState, useTransition } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Checkbox, Select } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/states";
import { Field, Input } from "@/components/ui/form";
import { Table, th, td } from "@/components/ui/misc";
import { relTime } from "@/lib/format";
import { maskedKey } from "@/lib/api/keys";
import { createKey, revokeKey, rotateKey } from "../actions";
import type { IssuedKey } from "../_lib/types";
import type { KeyView } from "../_lib/view";

type T = (k: string, v?: Record<string, string>) => string;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
export interface RoleOpt { value: string; label: string }
type Msg = { tone: "ok" | "error"; text: string };

function status(k: KeyView, now: string): "active" | "revoked" | "expired" {
  if (k.revokedAt) return "revoked";
  if (k.expiresAt && k.expiresAt <= now) return "expired";
  return "active";
}
const COLS = ["colName", "colKey", "colRole", "colScopes", "colLastUsed", "colExpires", "colStatus", "colActions"];

export function KeysView({ demo, keys, roles, scopes, strings }: { demo: boolean; keys: KeyView[]; roles: RoleOpt[]; scopes: string[]; strings: Record<string, string> }) {
  const t: T = (k, v = {}) => fill(strings[k] ?? k, v);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const now = new Date().toISOString();
  const report = (r: { ok: boolean; message: string; sub?: string }) => setMsg({ tone: r.ok ? "ok" : "error", text: r.ok ? [r.message, r.sub].filter(Boolean).join(". ") : r.message });
  return (
    <div className="grid gap-4">
      {demo && (
        <div role="note" className="rounded-control border border-line bg-paper-2 px-4 py-3">
          <p className="text-14 font-medium text-ink">{t("demoTitle")}</p>
          <p className="text-13 text-ink-2">{t("demoBody")}</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <a href="/api/v1/openapi.json" className="text-13 text-accent underline-offset-4 hover:underline">{t("docsLink")}</a>
        <CreateDialog t={t} roles={roles} scopes={scopes} demo={demo} onIssued={setIssued} onMessage={setMsg} />
      </div>
      {msg && <p role={msg.tone === "error" ? "alert" : "status"} className={msg.tone === "error" ? "text-13 text-danger" : "text-13 text-ink-2"}>{msg.text}</p>}
      {issued && <Issued t={t} issued={issued} onDone={() => setIssued(null)} />}
      {keys.length === 0 ? (
        <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <Table minWidth={880}>
          <thead>
            <tr>{COLS.map((c) => <th key={c} className={th}>{t(c)}</th>)}</tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const st = status(k, now);
              return (
                <tr key={k.id} className="border-t border-line">
                  <td className={td}>{k.name}</td>
                  <td className={td + " font-mono"}>{maskedKey(k.env, k.prefix)}</td>
                  <td className={td}>{k.roleLabel}</td>
                  <td className="px-3 py-2 text-12 text-ink"><div className="flex max-w-xs flex-wrap gap-1">{k.scopes.map((s) => <Chip key={s}>{s}</Chip>)}</div></td>
                  <td className={td}>{k.lastUsedAt ? relTime(k.lastUsedAt, now) : t("neverUsed")}</td>
                  <td className={td}>{k.expiresAt ? k.expiresAt.slice(0, 10) : t("neverExpires")}</td>
                  <td className={td}><Chip tone={st === "active" ? "success" : st === "revoked" ? "danger" : "warn"}>{t(st === "active" ? "statusActive" : st === "revoked" ? "statusRevoked" : "statusExpired")}</Chip></td>
                  <td className={td}>
                    {st === "active" && (
                      <div className="flex gap-2">
                        <Confirm t={t} kind="rotate" name={k.name} onRun={async () => { const r = await rotateKey({ id: k.id }); if (r.ok && r.data) setIssued(r.data); report(r); }} />
                        <Confirm t={t} kind="revoke" name={k.name} onRun={async () => { report(await revokeKey({ id: k.id })); }} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function Issued({ t, issued, onDone }: { t: T; issued: IssuedKey; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section aria-labelledby="issued-h" className="rounded-control border border-line-strong bg-surface p-5">
      <h2 id="issued-h" className="text-15 font-bold text-ink">{t("createdTitle")}</h2>
      <p className="mt-1 text-13 text-ink-2">{t("createdBody")}</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-chip border border-line bg-paper-2 px-3 py-2 font-mono text-13 text-ink" data-testid="issued-key">{issued.secret}</code>
        <Button variant="quiet" onClick={async () => { try { await navigator.clipboard.writeText(issued.secret); setCopied(true); } catch { setCopied(false); } }}><Copy aria-hidden />{copied ? t("copied") : t("copy")}</Button>
      </div>
      <div className="mt-3"><Button variant="primary" onClick={onDone}>{t("savedIt")}</Button></div>
    </section>
  );
}

function Confirm({ t, kind, name, onRun }: { t: T; kind: "rotate" | "revoke"; name: string; onRun: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant={kind === "revoke" ? "danger" : "quiet"}>{t(kind)}</Button></DialogTrigger>
      <DialogContent title={t(kind + "Title", { name })} description={t(kind + "Body")}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button variant="quiet">{t("cancel")}</Button></DialogClose>
          <Button variant={kind === "revoke" ? "danger" : "primary"} disabled={pending} onClick={() => start(async () => { await onRun(); setOpen(false); })}>{t(kind + "Confirm")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({ t, roles, scopes, demo, onIssued, onMessage }: { t: T; roles: RoleOpt[]; scopes: string[]; demo: boolean; onIssued: (k: IssuedKey) => void; onMessage: (m: Msg) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [env, setEnv] = useState("live");
  const [role, setRole] = useState(roles[roles.length - 1]?.value ?? "viewer");
  const [days, setDays] = useState("90");
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (s: string, on: boolean) => setPicked((p) => (on ? [...p, s] : p.filter((x) => x !== s)));
  const submit = () => start(async () => {
    setErr(null);
    const r = await createKey({ name, env, role, scopes: picked, expiresInDays: days === "never" ? null : Number(days) });
    if (!r.ok) { setErr(r.message); return; }
    if (r.data) onIssued(r.data);
    onMessage({ tone: "ok", text: [r.message, r.sub].filter(Boolean).join(". ") });
    setOpen(false); setName(""); setPicked([]);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="primary"><KeyRound aria-hidden />{t("createKey")}</Button></DialogTrigger>
      <DialogContent title={t("createKey")} description={demo ? t("demoBody") : undefined}>
        <div className="grid gap-3">
          <Field label={t("formName")} help={t("formNameHelp")} required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("formEnv")}>{(p) => <Select {...p} value={env} onValueChange={setEnv} options={[{ value: "live", label: t("envLive") }, { value: "test", label: t("envTest") }]} />}</Field>
            <Field label={t("formExpiry")}>{(p) => <Select {...p} value={days} onValueChange={setDays} options={[{ value: "30", label: t("expiry30") }, { value: "90", label: t("expiry90") }, { value: "365", label: t("expiry365") }, { value: "never", label: t("expiryNever") }]} />}</Field>
          </div>
          <Field label={t("formRole")} help={t("formRoleHelp")}>{(p) => <Select {...p} value={role} onValueChange={setRole} options={roles} />}</Field>
          <fieldset className="grid gap-1">
            <legend className="text-13 font-medium text-ink">{t("formScopes")}</legend>
            <p className="text-12 text-ink-3">{t("formScopesHelp")}</p>
            <div className="mt-1 grid max-h-44 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto">
              {scopes.map((s) => (
                <label key={s} className="flex items-center gap-2 text-13 text-ink">
                  <Checkbox checked={picked.includes(s)} onCheckedChange={(v) => toggle(s, v === true)} aria-label={s} />
                  <span className="font-mono text-12">{s}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {err && <p role="alert" className="text-13 text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button variant="quiet">{t("cancel")}</Button></DialogClose>
            <Button variant="primary" disabled={pending || name.trim().length < 2 || picked.length === 0} onClick={submit}>{t("submitCreate")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
