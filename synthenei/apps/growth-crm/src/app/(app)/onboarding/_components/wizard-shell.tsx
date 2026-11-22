"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ChevronRight, Circle, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Select } from "@/components/ui/controls";
import { Meter } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { contrastChecks } from "../../settings/_components/contrast";
import { chooseKit, finishOnboarding, inviteTeammate, markStepAction, saveBranding, saveModules, type ActionResult } from "../actions";
import type { StepDef, StepId } from "../_lib/types";

type Status = "todo" | "done" | "skipped";
interface Props {
  demo: boolean; steps: StepDef[]; resumeStep: StepId | null;
  statusOf: Record<StepId, Status>;
  current: { preset: string; brandName: string; product: string; hue: number; heading: string; body: string };
  modules: { key: string; enabled: boolean; locked: string | null; defaultOn: boolean }[];
  roleOptions: { id: string; name: string }[]; canBrand: boolean;
}

const LABEL: Record<StepId, string> = { template: "Starter kit", branding: "Branding", modules: "Modules", pipelines: "Pipeline", fields: "Custom fields", team: "Invite your team", integration: "Connect an integration", import: "Import leads" };

export function WizardShell(p: Props) {
  const [open, setOpen] = useState<StepId>(p.resumeStep ?? p.steps[0].id);
  const [status, setStatus] = useState(p.statusOf);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) => start(async () => {
    const r = await fn();
    toast(r.message, r.ok ? r.sub : undefined);
    if (r.ok) onOk?.();
  });
  const mark = (id: StepId, s: Status) => setStatus((old) => ({ ...old, [id]: s }));
  const after = (id: StepId, s: Status) => () => { mark(id, s); const next = p.steps.find((d) => (status[d.id] ?? "todo") === "todo" && d.id !== id); if (next) setOpen(next.id); };
  const done = Object.values(status).filter((s) => s === "done").length, skipped = Object.values(status).filter((s) => s === "skipped").length;
  const canFinish = p.steps.filter((d) => !d.optional).every((d) => status[d.id] === "done");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {p.demo && <p role="note" className="lg:col-span-2 rounded-control border border-dashed border-line-strong bg-paper px-3 py-2 text-12 text-ink-2">Demo workspace: steps validate and show what would happen, but nothing is saved.</p>}
      <nav aria-label="Setup steps" className="flex flex-col gap-1 lg:sticky lg:top-4 lg:self-start">
        <Meter value={done + skipped} max={p.steps.length} tone="accent" className="mb-2" />
        <p className="mb-1 text-12 text-ink-3 num">{done} done{skipped ? `, ${skipped} skipped` : ""} of {p.steps.length}</p>
        {p.steps.map((d) => {
          const s = status[d.id] ?? "todo";
          return (
            <button key={d.id} type="button" onClick={() => setOpen(d.id)} aria-current={open === d.id} data-status={s}
              className="flex items-center gap-2 rounded-control px-2.5 py-2 text-left text-13 aria-current:bg-paper-2 aria-current:font-medium hover:bg-paper-2">
              {s === "done" ? <Check className="size-4 text-success" aria-hidden /> : s === "skipped" ? <Circle className="size-4 text-ink-3" aria-hidden /> : open === d.id ? <CircleDot className="size-4 text-accent" aria-hidden /> : <Circle className="size-4 text-ink-3" aria-hidden />}
              <span className="flex-1 text-ink">{LABEL[d.id]}</span>
              {d.optional && s === "todo" && <span className="text-11 text-ink-3">Optional</span>}
            </button>
          );
        })}
        <Button className="mt-3" variant="primary" disabled={!canFinish || pending} onClick={() => run(finishOnboarding, () => { window.location.href = "/"; })}>
          Finish setup<ChevronRight />
        </Button>
        {!canFinish && <p className="text-11 text-ink-3">Finish every required step to leave setup (optional ones can stay skipped).</p>}
      </nav>

      <Card>
        {open === "template" && <TemplateStep current={p.current.preset} pending={pending} onPick={(kit) => run(() => chooseKit(kit), after("template", "done"))} />}
        {open === "branding" && <BrandingStep initial={p.current} canBrand={p.canBrand} pending={pending} onSave={(v) => run(() => saveBranding(v), after("branding", "done"))} />}
        {open === "modules" && <ModulesStep modules={p.modules} pending={pending} onSave={(v) => run(() => saveModules(v), after("modules", "done"))} />}
        {open === "pipelines" && <LinkStep title="Pipeline" home="/settings/pipelines" body="Set up your deal stages -- the starter kit already seeded a default pipeline, so this is a quick check, not a blank page." cta="Open pipeline settings" pending={pending} onDone={() => run(() => markStepAction("pipelines", "done"), after("pipelines", "done"))} />}
        {open === "fields" && <LinkStep title="Custom fields" home="/settings/fields" body="Add any field your team tracks that isn't here already." cta="Open custom fields" pending={pending} onDone={() => run(() => markStepAction("fields", "done"), after("fields", "done"))} />}
        {open === "team" && <TeamStep roleOptions={p.roleOptions} pending={pending} onInvite={(v) => run(() => inviteTeammate(v), after("team", "done"))} />}
        {open === "integration" && <LinkStep title="Connect an integration" home="/integrations" body="Optional -- connect WhatsApp, email or an ads account now, or skip and do it later." cta="Open integrations" optional pending={pending} onDone={() => run(() => markStepAction("integration", "done"), after("integration", "done"))} onSkip={() => run(() => markStepAction("integration", "skipped"), after("integration", "skipped"))} />}
        {open === "import" && <LinkStep title="Import leads" home="/import" body="Optional -- bring in a CSV of existing leads, or skip and add them as they come in." cta="Open import" optional pending={pending} onDone={() => run(() => markStepAction("import", "done"), after("import", "done"))} onSkip={() => run(() => markStepAction("import", "skipped"), after("import", "skipped"))} />}
      </Card>
    </div>
  );
}

function TemplateStep({ current, pending, onPick }: { current: string; pending: boolean; onPick: (kit: "legal" | "hospitality" | "blank") => void }) {
  const KITS: { id: "legal" | "hospitality" | "blank"; name: string; body: string }[] = [
    { id: "legal", name: "Legal practice", body: "Cases, hearings, firms and advocates -- legal vocabulary and pipeline stages." },
    { id: "hospitality", name: "Hospitality", body: "Reservations, rooms and party size -- hospitality vocabulary and pipeline stages." },
    { id: "blank", name: "Blank", body: "Neutral labels (leads, deals, accounts). Rename anything later." },
  ];
  return (
    <>
      <CardHeader title="Pick a starter kit" sub="Sets the labels, pipeline stages and dashboard tiles you start with. You can change any of it later in Settings." />
      <CardBody className="grid gap-3 sm:grid-cols-3">
        {KITS.map((k) => (
          <button key={k.id} type="button" disabled={pending} onClick={() => onPick(k.id)}
            className="flex flex-col gap-1 rounded-control border border-line-strong p-3 text-left hover:border-accent disabled:opacity-60 aria-pressed:border-accent aria-pressed:bg-paper-2"
            aria-pressed={current === k.id}>
            <span className="text-13 font-medium text-ink">{k.name}{current === k.id && <span className="ml-2 text-11 font-normal text-accent">Current</span>}</span>
            <span className="text-12 text-ink-2">{k.body}</span>
          </button>
        ))}
      </CardBody>
    </>
  );
}

function BrandingStep({ initial, canBrand, pending, onSave }: { initial: Props["current"]; canBrand: boolean; pending: boolean; onSave: (v: { name: string; product: string; hue: number; heading: string; body: string }) => void }) {
  const [name, setName] = useState(initial.brandName);
  const [product, setProduct] = useState(initial.product);
  const [hue, setHue] = useState(initial.hue);
  const checks = contrastChecks(hue);
  const passes = checks.every((c) => c.value >= c.min);
  const monogram = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <>
      <CardHeader title="Branding" sub="Your name, monogram and accent colour across the whole app." />
      <CardBody className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-3">
          <Field label="Organisation name"><Input value={name} maxLength={40} disabled={!canBrand} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Product name" help="Shown under your name in the sidebar."><Input value={product} maxLength={40} disabled={!canBrand} onChange={(e) => setProduct(e.target.value)} /></Field>
          <div>
            <div className="mb-1 flex items-center justify-between"><span className="text-13 font-medium text-ink">Accent hue</span><output className="font-mono text-12 num">{hue}°</output></div>
            <input type="range" min={0} max={359} step={1} value={hue} disabled={!canBrand} onChange={(e) => setHue(Number(e.target.value))} className="w-full accent-[var(--accent)]" aria-label="Accent hue" />
          </div>
          <ul className="flex flex-col gap-1 rounded-control border border-line bg-paper px-3 py-2 text-12" aria-live="polite">
            {checks.map((c) => <li key={c.key} className={c.value >= c.min ? "text-success" : "text-danger"}>{c.label}: {c.value.toFixed(2)}:1 {c.value >= c.min ? "pass" : "fail"}</li>)}
          </ul>
        </div>
        <div className="flex flex-col items-center gap-2 justify-self-center">
          <span className="grid size-16 place-items-center rounded-control text-24 font-semibold" style={{ background: `oklch(0.52 0.15 ${hue})`, color: `oklch(0.99 0.005 ${hue})` }} aria-hidden>{monogram}</span>
          <span className="text-11 text-ink-3">Monogram (from the first letter)</span>
        </div>
      </CardBody>
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
        {!canBrand && <span className="mr-auto text-12 text-ink-3">Only the primary owner can change branding -- you can skip this and come back.</span>}
        <Button variant="primary" disabled={!canBrand || !passes || pending} onClick={() => onSave({ name, product, hue, heading: initial.heading, body: initial.body })}>Save branding</Button>
      </div>
    </>
  );
}

function ModulesStep({ modules, pending, onSave }: { modules: Props["modules"]; pending: boolean; onSave: (v: Record<string, boolean>) => void }) {
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(modules.map((m) => [m.key, m.enabled])));
  return (
    <>
      <CardHeader title="Modules" sub="Turn off anything your team doesn't use -- it stays hidden from the nav until you turn it back on." />
      <CardBody className="grid gap-2 sm:grid-cols-2">
        {modules.map((m) => (
          <label key={m.key} className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-13 aria-disabled:opacity-50">
            <input type="checkbox" checked={!!on[m.key]} disabled={!!m.locked} onChange={(e) => setOn((o) => ({ ...o, [m.key]: e.target.checked }))} />
            <span className="flex-1 capitalize text-ink">{m.key.replace("-", " ")}</span>
            {m.locked && <span className="text-11 text-ink-3">{m.locked}</span>}
          </label>
        ))}
      </CardBody>
      <div className="flex justify-end border-t border-line px-4 py-3"><Button variant="primary" disabled={pending} onClick={() => onSave(on)}>Save modules</Button></div>
    </>
  );
}

function TeamStep({ roleOptions, pending, onInvite }: { roleOptions: { id: string; name: string }[]; pending: boolean; onInvite: (v: { email: string; roleId: string }) => void }) {
  const [email, setEmail] = useState(""); const [roleId, setRoleId] = useState(roleOptions[0]?.id ?? "");
  return (
    <>
      <CardHeader title="Invite your team" sub="Send the first invite now, or skip and invite people from Settings later." />
      <CardBody className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" /></Field>
        <Field label="Role"><Select value={roleId} onValueChange={setRoleId} options={roleOptions.map((r) => ({ value: r.id, label: r.name }))} /></Field>
        <Button variant="primary" disabled={!email || !roleId || pending} onClick={() => onInvite({ email, roleId })}>Send invite</Button>
      </CardBody>
      <div className="flex justify-end border-t border-line px-4 py-3"><Link href="/settings/roles" className="text-12 text-accent underline underline-offset-4">Manage the team in Settings</Link></div>
    </>
  );
}

function LinkStep({ title, home, body, cta, optional, pending, onDone, onSkip }: { title: string; home: string; body: string; cta: string; optional?: boolean; pending: boolean; onDone: () => void; onSkip?: () => void }) {
  return (
    <>
      <CardHeader title={title} sub={body} />
      <CardBody className="flex flex-wrap items-center gap-2">
        <Link href={home}><Button variant="primary">{cta}</Button></Link>
        <Button disabled={pending} onClick={onDone}><Check />Mark as done</Button>
        {optional && onSkip && <Button variant="ghost" disabled={pending} onClick={onSkip}>Skip for now</Button>}
      </CardBody>
    </>
  );
}
