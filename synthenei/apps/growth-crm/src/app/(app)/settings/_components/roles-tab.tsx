"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Lock, Pencil, Plus, ShieldQuestion, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { th, td } from "@/components/ui/misc";
import { PERMISSIONS } from "@/lib/authz/catalog";
import type { Grant, Scope } from "@/lib/authz/types";
import { cn } from "@/lib/utils";
import { checkRoleAssignment, checkRoleGrants, scopeRank, type BaseRole, type GrantInput, type Violation } from "../roles/_lib/guards";
import { createRole, deleteRole, explainAccess, updateRole } from "../roles/actions";
import type { ExplainView } from "../roles/_lib/types";
import { sa } from "../roles/_lib/strings";
import type { HeldView } from "../roles/_lib/view";

export interface RoleView { id: string; name: string; description: string; baseRole: BaseRole; isSystem: boolean; updatedAt: string; grants: GrantInput[]; people: number }
const BASES: BaseRole[] = ["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"];
const SCOPES: Scope[] = ["none", "own", "team", "all"];
const scopeLabel = (s: Scope) => sa(`scope${s[0].toUpperCase()}${s.slice(1)}`);
const selectCls = "h-8 rounded-chip border border-line-strong bg-surface pl-2 pr-7 text-12 text-ink outline-none focus:border-ring disabled:opacity-50";
const inputCls = "h-9 w-full rounded-chip border border-line-strong bg-surface px-2.5 text-13 text-ink outline-none focus:border-ring";

// Conditions the editor can build. Anything else on an existing grant is kept untouched (shown as a custom condition).
const PRESETS = {
  districts: { field: "record.district", op: "in", value: "@principal.attrs.districts" },
  hours: { field: "now", op: "between_hours", value: ["09:00", "20:00"], tz: "Asia/Kolkata" },
  consent: { field: "record.consent_whatsapp", op: "is_true" },
} as const;
type PresetKey = keyof typeof PRESETS;
const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => a.localeCompare(b))) : x));
const clausesOf = (c: unknown): unknown[] => (c && typeof c === "object" && Array.isArray((c as { all?: unknown[] }).all) ? (c as { all: unknown[] }).all : []);
interface Row { scope: Scope; presets: Record<PresetKey, boolean>; extra: unknown[]; fieldMask: string[] }
const emptyRow = (): Row => ({ scope: "none", presets: { districts: false, hours: false, consent: false }, extra: [], fieldMask: [] });
function rowOf(g?: GrantInput): Row {
  if (!g) return emptyRow();
  const r = emptyRow();
  r.scope = g.scope; r.fieldMask = g.fieldMask ?? [];
  for (const cl of clausesOf(g.conditions)) {
    const hit = (Object.keys(PRESETS) as PresetKey[]).find((k) => canon(PRESETS[k]) === canon(cl));
    if (hit) r.presets[hit] = true; else r.extra.push(cl);
  }
  return r;
}
function buildConditions(row: Row, held?: HeldView): unknown {
  const out: unknown[] = [];
  const add = (c: unknown) => { if (!out.some((x) => canon(x) === canon(c))) out.push(c); };
  (Object.keys(PRESETS) as PresetKey[]).forEach((k) => row.presets[k] && add(PRESETS[k]));
  row.extra.forEach(add);
  clausesOf(held?.conditions).forEach(add); // the grantor's own conditions are always carried along
  if (held?.conditions && !clausesOf(held.conditions).length) add(held.conditions);
  return out.length ? { all: out } : {};
}

export function RolesTab({ roles, held, baseRole, uid, canManage, customAllowed, demo }: {
  roles: RoleView[]; held: Record<string, HeldView>; baseRole: BaseRole; uid: string; canManage: boolean; customAllowed: boolean; demo: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ role: RoleView | null; seed: RoleView | null } | null>(null);
  const custom = roles.filter((r) => !r.isSystem), system = roles.filter((r) => r.isSystem);
  const why = !canManage ? sa("authz_no_permission") : !customAllowed ? `${sa("customRolesOff")} ${sa("customRolesOffWhy")}` : null;
  const edit = (role: RoleView | null, seed: RoleView | null) => setEditing({ role, seed });

  const table = (list: RoleView[], isSystem: boolean) => (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: 640 }}>
        <caption className="sr-only">{isSystem ? sa("systemRole") : sa("customRole")}</caption>
        <thead><tr className="border-y border-line bg-paper/60">
          <th scope="col" className={th}>{sa("colRole")}</th><th scope="col" className={th}>{sa("colPerms")}</th><th scope="col" className={th}>{sa("colMembers")}</th><th scope="col" className={th}><span className="sr-only">{sa("colActions")}</span></th>
        </tr></thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className={cn(td, "h-12")}><div className="font-medium">{r.name}</div>{r.description && <div className="max-w-[320px] truncate text-12 text-ink-3">{r.description}</div>}</td>
              <td className={cn(td, "num text-ink-2")}>{r.grants.filter((g) => g.scope !== "none").length}</td>
              <td className={cn(td, "num text-ink-2")}>{r.people}</td>
              <td className={cn(td, "text-right")}>
                <span className="inline-flex gap-1">
                  <DisabledReason reason={why}><Button size="sm" variant="ghost" onClick={() => edit(null, r)} aria-label={`${sa("cloneRole")} ${r.name}`}><Copy />{sa("cloneRole")}</Button></DisabledReason>
                  {isSystem
                    ? <Button size="sm" variant="ghost" onClick={() => edit(r, null)} aria-label={`${sa("viewRole")} ${r.name}`}><Lock />{sa("viewRole")}</Button>
                    : <>
                        <DisabledReason reason={why}><Button size="sm" variant="ghost" onClick={() => edit(r, null)} aria-label={`${sa("editRole")} ${r.name}`}><Pencil />{sa("editRole")}</Button></DisabledReason>
                        <DeleteRole role={r} disabledReason={why} onDone={() => router.refresh()} />
                      </>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {!customAllowed && (
        <div role="status" className="state-warn zone-work flex flex-col gap-1 rounded-control border">
          <p className="text-13 font-medium text-ink">{sa("customOffTitle")}</p>
          <p className="text-13 text-ink-2">{sa("customOffBody")}</p>
        </div>
      )}
      <Card>
        <CardHeader title={sa("rolesTitle")} sub={sa("rolesSub")}
          action={<DisabledReason reason={why}><Button variant="primary" size="sm" onClick={() => edit(null, null)}><Plus />{sa("newRole")}</Button></DisabledReason>} />
        {custom.length === 0
          ? <div className="zone-work"><EmptyState title={sa("emptyRolesTitle")} body={sa("emptyRolesBody")} /></div>
          : table(custom, false)}
        <div className="label-caps zone-work pb-1 pt-3">{sa("systemRole")}</div>
        {table(system, true)}
      </Card>
      <ExplainPanel roles={roles} />
      {editing && (
        <RoleEditor key={editing.role?.id ?? `new-${editing.seed?.id ?? "blank"}`} role={editing.role} seed={editing.seed} held={held} baseRole={baseRole} uid={uid} demo={demo}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />
      )}
    </div>
  );
}

function DeleteRole({ role, disabledReason, onDone }: { role: RoleView; disabledReason: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const inUse = role.people > 0;
  const btn = <Button size="sm" variant="ghost" aria-label={`${sa("deleteRole")} ${role.name}`}><Trash2 />{sa("deleteRole")}</Button>;
  const reason = disabledReason ?? (inUse ? sa("roleInUse") : null);
  if (reason) return <DisabledReason reason={reason}>{btn}</DisabledReason>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{btn}</DialogTrigger>
      <DialogContent title={sa("deleteRoleTitle", { name: role.name })} description={sa("deleteRoleDesc")}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button>{sa("cancel")}</Button></DialogClose>
          <Button variant="danger" disabled={pending} onClick={() => start(async () => { const r = await deleteRole({ roleId: role.id }); toast(r.message, r.sub); if (r.ok) { setOpen(false); onDone(); } })}>{sa("deleteRole")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RoleEditor({ role, seed, held, baseRole, uid, demo, onClose, onSaved }: {
  role: RoleView | null; seed: RoleView | null; held: Record<string, HeldView>; baseRole: BaseRole; uid: string; demo: boolean; onClose: () => void; onSaved: () => void;
}) {
  const readOnly = !!role?.isSystem;
  const source = role ?? seed;
  const [name, setName] = useState(role ? role.name : seed ? `${seed.name} copy` : "");
  const [description, setDescription] = useState(source?.description ?? "");
  const [base, setBase] = useState<BaseRole>(source?.baseRole ?? "sales_rep");
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries((source?.grants ?? []).map((g) => [g.permission, rowOf(g)])));
  const [q, setQ] = useState("");
  const [err, setErr] = useState<{ message: string; conflict?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const defs = useMemo(() => PERMISSIONS.filter((p) => !p.platformOnly), []);
  const heldGrants = held as Record<string, Grant>;
  const actor = useMemo(() => ({ uid, baseRole, held: heldGrants }), [uid, baseRole, heldGrants]);

  const inputs: GrantInput[] = useMemo(() => Object.entries(rows).filter(([, r]) => r.scope !== "none").map(([permission, r]) => ({ permission, scope: r.scope, conditions: buildConditions(r, held[permission]), fieldMask: r.fieldMask })), [rows, held]);
  const violations = useMemo(() => new Map<string, Violation>(checkRoleGrants(heldGrants, inputs, { actorBaseRole: baseRole }).map((v) => [v.permission, v])), [heldGrants, inputs, baseRole]);
  const baseOk = (b: BaseRole) => checkRoleAssignment(actor, { baseRole: b, custom: false }).ok;
  const blocked = readOnly ? sa("systemRoleReadOnly") : name.trim().length < 2 ? sa("fieldRoleName") : violations.size ? sa("deny_role_exceeds_you") : !baseOk(base) ? sa("deny_out_of_scope") : null;
  const set = (perm: string, fn: (r: Row) => Row) => setRows((x) => ({ ...x, [perm]: fn(x[perm] ?? emptyRow()) }));
  const shown = defs.filter((p) => !q || p.key.includes(q.toLowerCase()) || p.description.toLowerCase().includes(q.toLowerCase()));

  const save = () => start(async () => {
    setErr(null);
    const body = { name: name.trim(), description: description.trim(), baseRole: base, grants: inputs };
    const r = role ? await updateRole({ ...body, roleId: role.id, expectedUpdatedAt: role.updatedAt }) : await createRole(body);
    if (r.ok) { toast(r.message, r.sub); onSaved(); } else setErr({ message: [r.message, r.sub].filter(Boolean).join(" "), conflict: r.code === "conflict" });
  });

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent title={role ? role.name : seed ? sa("roleCloneTitle", { name: seed.name }) : sa("roleNewTitle")} description={sa("roleEditorTitle")} className="w-[min(46rem,100vw)]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("fieldRoleName")}
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} maxLength={60} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("fieldBase")}
              <select value={base} onChange={(e) => setBase(e.target.value as BaseRole)} disabled={readOnly} className={cn(selectCls, "h-9 text-13")}>
                {BASES.map((b) => <option key={b} value={b} disabled={!baseOk(b)}>{b.replace("_", " ")}</option>)}
              </select>
              <span className="font-normal text-ink-3">{sa("baseHelp")}</span>
            </label>
            <label className="flex flex-col gap-1 text-12 font-medium text-ink-2 sm:col-span-2">{sa("fieldRoleDesc")}
              <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} maxLength={240} className={inputCls} />
            </label>
          </div>
          <div>
            <input aria-label={sa("searchPerms")} placeholder={sa("searchPerms")} value={q} onChange={(e) => setQ(e.target.value)} className={cn(inputCls, "mb-2")} />
            <p className="mb-2 text-12 text-ink-3">{sa("scopeHelp")}</p>
            <div className="scrollbar-thin overflow-x-auto rounded-control border border-line">
              <table className="w-full border-collapse" style={{ minWidth: 560 }}>
                <thead><tr className="border-b border-line bg-paper/60">
                  <th scope="col" className={th}>{sa("colPermission")}</th><th scope="col" className={th}>{sa("colScope")}</th><th scope="col" className={th}>{sa("colConditions")}</th>
                </tr></thead>
                <tbody>
                  {shown.map((p) => {
                    const row = rows[p.key] ?? emptyRow();
                    const h = held[p.key];
                    const v = violations.get(p.key);
                    const maxRank = h ? scopeRank(h.scope) : 0;
                    const rowWhy = !h || h.scope === "none" ? sa("notHeld") : sa("heldUpTo", { scope: scopeLabel(h.scope) });
                    return (
                      <tr key={p.key} className={cn("border-b border-line last:border-0", v && "state-danger")}>
                        <td className={cn(td, "h-auto py-2 whitespace-normal")}>
                          <div className="font-mono text-12">{p.key}</div>
                          <div className="text-12 text-ink-3">{p.description}{p.supportBlocked ? ` ${sa("supportBlockedPerm")}` : ""}</div>
                          {v && <div className="mt-0.5 text-12 font-medium">{sa(`viol_${v.code}`)}</div>}
                        </td>
                        <td className={cn(td, "py-2")}>
                          <select aria-label={`${p.key} ${sa("colScope")}`} value={row.scope} disabled={readOnly} title={readOnly ? undefined : rowWhy}
                            onChange={(e) => set(p.key, (r) => ({ ...r, scope: e.target.value as Scope }))} className={selectCls}>
                            {SCOPES.map((s) => <option key={s} value={s} disabled={!readOnly && s !== "none" && scopeRank(s) > maxRank}>{scopeLabel(s)}</option>)}
                          </select>
                        </td>
                        <td className={cn(td, "py-2 whitespace-normal")}>
                          {row.scope === "none" ? <span className="text-ink-3">-</span> : (
                            <details>
                              <summary className="cursor-pointer text-12 text-ink-2">{(buildConditions(row, h) as { all?: unknown[] }).all?.length ?? 0}</summary>
                              <div className="mt-1 flex flex-col gap-1">
                                {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
                                  <label key={k} className="flex items-center gap-1.5 text-12 text-ink-2">
                                    <input type="checkbox" checked={row.presets[k]} disabled={readOnly} onChange={(e) => set(p.key, (r) => ({ ...r, presets: { ...r.presets, [k]: e.target.checked } }))} />
                                    {sa(k === "districts" ? "condDistricts" : k === "hours" ? "condHours" : "condConsent")}
                                  </label>
                                ))}
                                {row.extra.length > 0 && <span className="text-12 text-ink-3">{sa("condCustom")}</span>}
                                {clausesOf(h?.conditions).length > 0 && <span className="text-12 text-ink-3">{sa("condLocked")}</span>}
                              </div>
                            </details>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {err && (
            <div role="alert" className="state-danger flex flex-wrap items-center justify-between gap-2 rounded-chip px-3 py-2 text-12">
              <span>{err.conflict ? sa("roleChangedElsewhere") : err.message}</span>
              {err.conflict && <Button size="sm" onClick={onSaved}>{sa("reload")}</Button>}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <SheetClose asChild><Button type="button">{sa("cancel")}</Button></SheetClose>
            {!readOnly && <DisabledReason reason={blocked}><Button variant="primary" disabled={pending} onClick={save}>{pending ? sa("saving") : role ? sa("saveRole") : sa("createRole")}</Button></DisabledReason>}
          </div>
          {demo && <p className="text-12 text-ink-3">{sa("demoNotice")}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ExplainPanel({ roles }: { roles: RoleView[] }) {
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [perm, setPerm] = useState("leads.read");
  const [res, setRes] = useState<ExplainView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    setErr(null);
    const r = await explainAccess({ permission: perm, roleId });
    if (r.ok && r.data) setRes(r.data); else { setRes(null); setErr(r.ok ? sa("errorBody") : r.message); }
  });
  return (
    <Card>
      <CardHeader title={sa("explainTitle")} sub={sa("explainSub")} action={<ShieldQuestion className="size-4 text-ink-3" strokeWidth={1.75} aria-hidden />} />
      <CardBody>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("explainRole")}
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={cn(selectCls, "h-9 text-13")}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("explainPerm")}
            <select value={perm} onChange={(e) => setPerm(e.target.value)} className={cn(selectCls, "h-9 text-13 font-mono")}>{PERMISSIONS.filter((p) => !p.platformOnly).map((p) => <option key={p.key} value={p.key}>{p.key}</option>)}</select>
          </label>
          <Button variant="primary" size="sm" disabled={pending || !roleId} onClick={run}>{sa("explainRun")}</Button>
        </div>
        <div className="mt-3" aria-live="polite">
          {err && <p role="alert" className="state-danger rounded-chip px-3 py-2 text-12">{err}</p>}
          {!res && !err && <p className="text-13 text-ink-3">{sa("explainEmpty")}</p>}
          {res && (
            <div className="flex flex-col gap-2">
              <Badge tone={res.allow ? "success" : "danger"}>{res.allow ? sa("explainAllowed") : sa("explainDenied", { step: res.step, reason: (res.reason ?? "").replace(/_/g, " ") })}</Badge>
              <ol className="divide-y divide-line rounded-control border border-line">
                {res.steps.map((s) => (
                  <li key={s.step} className="flex items-start gap-3 px-3 py-2 text-12">
                    <span className="num w-4 text-ink-3">{s.step}</span>
                    <span className="w-28 font-medium text-ink">{s.name}</span>
                    <span className={cn("w-14", s.passed ? "text-success" : "text-danger")}>{s.passed ? sa("stepPassed") : sa("stepFailed")}</span>
                    <span className="min-w-0 flex-1 text-ink-2">{s.detail}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
