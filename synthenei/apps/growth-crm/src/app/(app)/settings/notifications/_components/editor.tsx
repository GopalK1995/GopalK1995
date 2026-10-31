"use client";
// Preferences (own), quiet hours (IST) and the rules editor (notifications.manage). Ledger zone: 12 px rows.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { fill, type Strings } from "@/components/collab/strings";
import type { Channel, Digest, PrefRow, RuleRow } from "@/lib/notify/types";
import { removeRule, savePref, saveQuiet, saveRule } from "../actions";

const KINDS = ["*", "lead.*", "deal.*", "task.*", "comment.*", "mention.*"];
const DIGESTS: Digest[] = ["instant", "hourly", "daily", "off"];
const digestKey = (d: Digest) => ({ instant: "digestInstant", hourly: "digestHourly", daily: "digestDaily", off: "digestOff" })[d];
const REC = [["owner", "recOwner"], ["team_manager", "recManager"], ["followers", "recFollowers"]] as const;

function PrefRowEditor({ kind, pref, s, demo }: { kind: string; pref: PrefRow | undefined; s: Strings; demo: boolean }) {
  const [email, setEmail] = useState(pref ? pref.channels.includes("email") : false);
  const [digest, setDigest] = useState<Digest>(pref?.digest ?? "instant");
  const [busy, start] = useTransition();
  const save = (nextEmail: boolean, nextDigest: Digest) => start(async () => {
    const channels: ("in_app" | "email")[] = nextEmail ? ["in_app", "email"] : ["in_app"];
    const r = await savePref({ kind, channels, digest: nextDigest });
    toast(r.message, r.ok ? (r.sub ?? "") : "");
    void demo;
  });
  return (
    <tr className="h-10 border-b border-line last:border-0">
      <td className="px-3 text-12 font-semibold text-ink">{kind === "*" ? s.prefsAllEvents : kind}</td>
      <td className="px-3"><Switch checked disabled aria-label={`${s.prefsInApp} ${kind}`} disabledReason={s.rulesSub} /></td>
      <td className="px-3"><Switch checked={email} disabled={busy || digest === "off"} aria-label={`${s.prefsEmail} ${kind}`} onCheckedChange={(v) => { setEmail(v); save(v, digest); }} /></td>
      <td className="px-3">
        <Select value={digest} aria-label={`${s.prefsDigest} ${kind}`} disabled={busy} onValueChange={(v) => { setDigest(v as Digest); save(email, v as Digest); }}
          options={DIGESTS.map((d) => ({ value: d, label: s[digestKey(d)] }))} />
      </td>
    </tr>
  );
}

function Quiet({ initial, s }: { initial: { from: string; to: string } | null; s: Strings }) {
  const [from, setFrom] = useState(initial?.from ?? "22:00");
  const [to, setTo] = useState(initial?.to ?? "07:00");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const go = (input: { from: string; to: string } | { clear: true }) => start(async () => {
    setError(null);
    const r = await saveQuiet(input);
    if (!r.ok) { setError(r.message); return; }
    toast(r.message, r.sub ?? "");
  });
  return (
    <section aria-labelledby="quiet-h" className="grid gap-2 rounded-control border border-line p-4">
      <h2 id="quiet-h" className="text-15 font-bold tracking-[-0.015em] text-ink">{s.quietTitle}</h2>
      <p className="text-13 text-ink-2">{s.quietBody}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-12 text-ink-3">{s.quietFrom}<Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="w-28" /></label>
        <label className="grid gap-1 text-12 text-ink-3">{s.quietTo}<Input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="w-28" /></label>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => go({ from, to })}>{s.quietSave}</Button>
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => go({ clear: true })}>{s.quietClear}</Button>
      </div>
      {error && <p role="alert" className="text-12 text-danger">{error}</p>}
    </section>
  );
}

function RuleEditor({ rule, eventOptions, s }: { rule: RuleRow | null; eventOptions: string[]; s: Strings }) {
  const router = useRouter();
  const [eventType, setEventType] = useState(rule?.eventType ?? eventOptions[0] ?? "lead.assigned");
  const [recipients, setRecipients] = useState<string[]>(rule?.recipients ?? ["owner"]);
  const [email, setEmail] = useState(rule?.channels.includes("email") ?? false);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const extra = recipients.filter((r) => !REC.some(([k]) => k === r)); // role:/user: tokens are kept, not editable here
  const toggle = (k: string) => setRecipients((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k]));
  const submit = () => start(async () => {
    setError(null);
    const channels: Channel[] = email ? ["in_app", "email"] : ["in_app"];
    const r = await saveRule({ id: rule?.id, eventType, recipients, channels: channels as ("in_app" | "email")[], enabled, template: rule?.template ?? {} });
    if (!r.ok) { setError(r.message); return; }
    toast(r.message, r.sub ?? "");
    router.refresh();
  });
  return (
    <li className="grid gap-3 px-4 py-3" data-testid="rule">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid gap-1 text-12 text-ink-3">{s.ruleEvent}
          <Select value={eventType} onValueChange={setEventType} aria-label={s.ruleEvent} options={[...new Set([eventType, ...eventOptions])].map((e) => ({ value: e, label: e }))} />
        </label>
        <label className="flex items-center gap-2 self-end text-13 text-ink">
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={s.ruleToggle} />{s.ruleEnabled}
        </label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-13 text-ink">
        <legend className="mb-1 text-12 text-ink-3">{s.ruleRecipients}</legend>
        {REC.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={recipients.includes(k)} onChange={() => toggle(k)} />{s[label]}</label>
        ))}
        {extra.map((x) => <span key={x} className="rounded-chip border border-line px-1.5 text-12 text-ink-2">{x.split(":")[0]}</span>)}
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-13 text-ink">
        <legend className="mb-1 text-12 text-ink-3">{s.ruleChannels}</legend>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked disabled />{s.chInApp}</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />{s.chEmail}</label>
        <label className="flex items-center gap-1.5 text-ink-3" title={s.chDisabledReason}><input type="checkbox" disabled />{s.chWhatsapp}</label>
        <label className="flex items-center gap-1.5 text-ink-3" title={s.chDisabledReason}><input type="checkbox" disabled />{s.chPush}</label>
      </fieldset>
      {error && <p role="alert" className="text-12 text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={busy || recipients.length === 0} onClick={submit}>{s.save}</Button>
        {rule && <Button variant="danger" size="sm" disabled={busy} onClick={() => start(async () => {
          const r = await removeRule({ id: rule.id });
          toast(r.message, r.ok ? (r.sub ?? "") : "");
          if (r.ok) router.refresh();
        })}>{s.ruleRemove}</Button>}
      </div>
    </li>
  );
}

export function NotificationSettings({ prefs, quiet, rules, canManage, eventOptions, demo, s }: {
  prefs: PrefRow[]; quiet: { from: string; to: string } | null; rules: RuleRow[]; canManage: boolean; eventOptions: string[]; demo: boolean; s: Strings;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-6">
      {demo && <p role="status" className="rounded-control border border-line bg-paper-2 px-3 py-2 text-12 text-ink-2">{s.prefsDemoNotice}</p>}
      <section aria-labelledby="prefs-h" className="grid gap-2">
        <h2 id="prefs-h" className="text-15 font-bold tracking-[-0.015em] text-ink">{s.prefsTitle}</h2>
        <p className="text-13 text-ink-2">{s.prefsSub}</p>
        <div className="overflow-x-auto rounded-control border border-line">
          <table className="w-full min-w-[560px] text-left">
            <thead><tr className="h-9 border-b border-line text-12 uppercase tracking-[0.05em] text-ink-3">
              <th className="px-3 font-medium">{s.prefsEvent}</th><th className="px-3 font-medium">{s.prefsInApp}</th><th className="px-3 font-medium">{s.prefsEmail}</th><th className="px-3 font-medium">{s.prefsDigest}</th>
            </tr></thead>
            <tbody>{KINDS.map((k) => <PrefRowEditor key={k} kind={k} pref={prefs.find((p) => p.kind === k)} s={s} demo={demo} />)}</tbody>
          </table>
        </div>
        <p className="text-12 text-ink-3">{s.prefsMutedNote}</p>
      </section>
      <Quiet initial={quiet} s={s} />
      <section aria-labelledby="rules-h" className="grid gap-2">
        <div className="flex items-center justify-between">
          <h2 id="rules-h" className="text-15 font-bold tracking-[-0.015em] text-ink">{s.rulesTitle}</h2>
          <Button size="sm" variant="primary" onClick={() => setAdding(true)} disabled={!canManage || adding} disabledReason={canManage ? undefined : s.rulesDeniedTitle}>{s.ruleAdd}</Button>
        </div>
        <p className="text-13 text-ink-2">{s.rulesSub}</p>
        {!canManage ? <EmptyState title={s.rulesDeniedTitle} body={s.rulesDeniedBody} />
          : rules.length === 0 && !adding ? <EmptyState title={s.rulesEmpty} body={s.rulesEmptyBody} />
          : (
            <ul className="divide-y divide-line rounded-control border border-line">
              {adding && <RuleEditor rule={null} eventOptions={eventOptions} s={s} />}
              {rules.map((r) => <RuleEditor key={`${r.id}:${r.enabled}:${r.eventType}`} rule={r} eventOptions={eventOptions} s={s} />)}
            </ul>
          )}
        <span className="sr-only">{fill(s.rulesSub)}</span>
      </section>
    </div>
  );
}
