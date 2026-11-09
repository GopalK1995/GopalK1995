"use client";
// /settings/email: sender identity, domain verification (state exactly as the provider or DNS reported it), webhook secret,
// suppression list and the Mailchimp audience. Every state is shown honestly: Showcase for the sandbox, Unknown when nothing could be
// asked, never "verified" without evidence. Icon plus word on every status, never colour alone.
import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, HelpCircle, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Select } from "@/components/ui/controls";
import { Table, td, th } from "@/components/ui/misc";
import type { ActionResult } from "@/lib/actions/result";
import type { DomainState } from "@/lib/connectors/email/transport";
import type { McAudience } from "@/lib/connectors/mailchimp/api";
import { chooseAudience, checkDomain, createMailchimpHook, pushSegment, saveIdentity, saveWebhookSecret } from "../actions";
import type { ConnView, McView, SegmentOption, SuppressionRow } from "../_lib/view";

type S = Record<string, string>;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in v ? v[k] : m));
const STATUS: Record<string, { tone: ChipTone; icon: typeof CheckCircle2 }> = {
  verified: { tone: "success", icon: CheckCircle2 }, pending: { tone: "warn", icon: Clock }, failed: { tone: "danger", icon: XCircle },
  not_started: { tone: "neutral", icon: CircleDashed }, unknown: { tone: "neutral", icon: HelpCircle }, showcase: { tone: "accent", icon: Sparkles },
};
function StatusChip({ status, s }: { status: string; s: S }) {
  const m = STATUS[status] ?? STATUS.unknown, Icon = m.icon;
  return <Chip tone={m.tone} icon={<Icon aria-hidden />} data-domain-status={status}>{s[`domain.status.${status}`] ?? status}</Chip>;
}

export function EmailSettings(p: { s: S; demo: boolean; email: ConnView | null; mailchimp: McView | null; suppressions: SuppressionRow[]; suppressionMissing: boolean; segments: SegmentOption[]; audiences: McAudience[] | null; webhookUrl: string | null }) {
  const { s } = p;
  if (!p.email && !p.mailchimp) {
    return (
      <main className="grid gap-6" data-testid="email-settings">
        <section className="rounded-card border border-line bg-surface p-4">
          <h2 className="text-15 font-semibold text-ink">{s.notConnectedTitle}</h2>
          <p className="mt-1 text-13 text-ink-2">{s.notConnectedBody}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link className="text-13 font-medium text-accent underline" href="/integrations/resend">{s.connectResend}</Link>
            <Link className="text-13 font-medium text-accent underline" href="/integrations/email-smtp">{s.connectSmtp}</Link>
            <Link className="text-13 font-medium text-accent underline" href="/integrations/mailchimp">{s["mailchimp.connect"]}</Link>
          </div>
        </section>
      </main>
    );
  }
  return (
    <main className="grid gap-8" data-testid="email-settings">
      {p.email && <Identity s={s} c={p.email} demo={p.demo} />}
      {p.email && <Domain s={s} c={p.email} />}
      {p.email?.connectorId === "resend" && <Webhook s={s} c={p.email} url={p.webhookUrl} />}
      {p.email?.connectorId === "email-smtp" && <p className="text-13 text-ink-2">{s.webhookSmtpNote}</p>}
      <Suppressions s={s} rows={p.suppressions} missing={p.suppressionMissing} />
      <Mailchimp s={s} m={p.mailchimp} audiences={p.audiences} segments={p.segments} demo={p.demo} />
    </main>
  );
}

function useAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sub?: string } | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>) => start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.message, sub: r.sub }); });
  return { pending, msg, run };
}
const Msg = ({ m }: { m: { ok: boolean; text: string; sub?: string } | null }) => (m ? <p role="status" className={`text-13 ${m.ok ? "text-ink-2" : "text-danger"}`}>{m.text}{m.sub ? ` ${m.sub}` : ""}</p> : null);

function Identity({ s, c, demo }: { s: S; c: ConnView; demo: boolean }) {
  const [v, setV] = useState({ fromName: c.sender.fromName ?? "", fromEmail: c.sender.fromEmail ?? "", replyTo: c.sender.replyTo ?? "", footer: c.sender.footer ?? "", dkimSelector: c.sender.dkimSelector ?? "" });
  const a = useAction();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <section aria-labelledby="em-identity" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="em-identity" className="text-15 font-semibold text-ink">{s.identityTitle}</h2>
        {(c.showcase || demo) && <Chip tone="accent" icon={<Sparkles aria-hidden />} data-testid="email-showcase">{s.showcase}</Chip>}
      </div>
      <p className="text-13 text-ink-2">{s.identityHelp}</p>
      {(c.showcase || demo) && <p className="text-13 text-ink-2">{s.showcaseSub}</p>}
      {c.lastError && <p role="alert" className="flex items-center gap-1 text-13 text-danger"><AlertTriangle className="size-4" aria-hidden />{c.lastError}</p>}
      <form className="grid max-w-xl gap-3" onSubmit={(e) => { e.preventDefault(); a.run(() => saveIdentity({ connectionId: c.id, ...v })); }}>
        <Field label={s.fromName}><Input value={v.fromName} onChange={set("fromName")} maxLength={80} autoComplete="off" /></Field>
        <Field label={s.fromEmail} help={s.fromEmailHelp} required><Input type="email" value={v.fromEmail} onChange={set("fromEmail")} autoComplete="off" /></Field>
        <Field label={s.replyTo}><Input type="email" value={v.replyTo} onChange={set("replyTo")} autoComplete="off" /></Field>
        <Field label={s.footer} help={s.footerHelp}><Textarea value={v.footer} onChange={set("footer")} maxLength={500} /></Field>
        {c.connectorId === "email-smtp" && <Field label={s.dkimSelector} help={s.dkimSelectorHelp}><Input value={v.dkimSelector} onChange={set("dkimSelector")} autoComplete="off" /></Field>}
        <div className="flex items-center gap-3"><Button type="submit" disabled={a.pending}>{s.save}</Button><Msg m={a.msg} /></div>
      </form>
    </section>
  );
}

function Domain({ s, c }: { s: S; c: ConnView }) {
  const a = useAction();
  const d: DomainState | null = c.domain;
  return (
    <section aria-labelledby="em-domain" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="em-domain" className="text-15 font-semibold text-ink">{s.domainTitle}</h2>
        {d ? <StatusChip status={d.status} s={s} /> : <Chip tone="neutral" icon={<CircleDashed aria-hidden />}>{s.domainNotChecked}</Chip>}
      </div>
      <p className="text-13 text-ink-2">{s.domainHelp}</p>
      {c.showcase && <p className="text-13 text-ink-2">{s.domainShowcaseNote}</p>}
      {c.connectorId === "email-smtp" && <p className="text-13 text-ink-2">{s.domainSmtpNote}</p>}
      {d && d.records.length > 0 && (
        <Table minWidth={640}>
          <thead><tr><th className={th}>{s.colKind}</th><th className={th}>{s.colType}</th><th className={th}>{s.colHost}</th><th className={th}>{s.colValue}</th><th className={th}>{s.colStatus}</th></tr></thead>
          <tbody>{d.records.map((r, i) => (
            <tr key={i} data-record-kind={r.kind}>
              <td className={td}>{s[`record.${r.kind}`] ?? r.kind}</td><td className={td}>{r.type}</td>
              <td className={`${td} font-mono`}>{r.host}</td><td className={`${td} max-w-[28ch] truncate font-mono`} title={r.value}>{r.value}</td>
              <td className={td}><StatusChip status={r.status} s={s} /></td>
            </tr>))}</tbody>
        </Table>
      )}
      {d && <p className="text-12 text-ink-3">{fill(s.domainCheckedAt, { when: d.status === "showcase" ? "-" : new Date(d.checkedAt).toLocaleString() })}</p>}
      <div className="flex items-center gap-3">
        <Button variant="quiet" disabled={a.pending || !c.sender.fromEmail} disabledReason={!c.sender.fromEmail ? s.domainNoSender : undefined} onClick={() => a.run(() => checkDomain(c.id))}>{s.domainCheck}</Button>
        <Msg m={a.msg} />
      </div>
    </section>
  );
}

function Webhook({ s, c, url }: { s: S; c: ConnView; url: string | null }) {
  const [secret, setSecret] = useState("");
  const a = useAction();
  return (
    <section aria-labelledby="em-hook" className="grid max-w-xl gap-3">
      <h2 id="em-hook" className="text-15 font-semibold text-ink">{s.webhookTitle}</h2>
      <p className="text-13 text-ink-2">{s.webhookHelp}</p>
      {url && <Field label={s.webhookUrl}><Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} /></Field>}
      <p className={`text-13 ${c.webhookSecretSet ? "text-ink-2" : "text-warn"}`} role="status">{c.webhookSecretSet ? s.webhookSecretPresent : s.webhookSecretMissing}</p>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); a.run(async () => { const r = await saveWebhookSecret(c.id, secret); if (r.ok) setSecret(""); return r; }); }}>
        <Field label={s.webhookSecret} help={s.webhookSecretHelp}><Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></Field>
        <div className="flex items-center gap-3"><Button type="submit" disabled={a.pending || !secret}>{s.webhookSecretSave}</Button><Msg m={a.msg} /></div>
      </form>
    </section>
  );
}

function Suppressions({ s, rows, missing }: { s: S; rows: SuppressionRow[]; missing: boolean }) {
  return (
    <section aria-labelledby="em-sup" className="grid gap-3">
      <h2 id="em-sup" className="text-15 font-semibold text-ink">{s.suppressionTitle}</h2>
      <p className="text-13 text-ink-2">{s.suppressionHelp}</p>
      {missing && <p className="text-13 text-warn" role="status">{s.suppressionMissing}</p>}
      {!rows.length && !missing && <p className="text-13 text-ink-2" data-testid="suppression-empty">{s.suppressionEmpty}</p>}
      {rows.length > 0 && (
        <Table minWidth={560}>
          <thead><tr><th className={th}>{s.colEmail}</th><th className={th}>{s.colReason}</th><th className={th}>{s.colSource}</th><th className={th}>{s.colWhen}</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td className={td}>{r.email}</td><td className={td}>{s[`reason.${r.reason}`] ?? r.reason}</td><td className={td}>{r.source}</td><td className={td}>{new Date(r.at).toLocaleDateString()}</td></tr>)}</tbody>
        </Table>
      )}
    </section>
  );
}

function Mailchimp({ s, m, audiences, segments, demo }: { s: S; m: McView | null; audiences: McAudience[] | null; segments: SegmentOption[]; demo: boolean }) {
  const [aud, setAud] = useState(m?.audienceId ?? ""), [seg, setSeg] = useState("");
  const [hook, setHook] = useState<string | null>(null);
  const a = useAction();
  return (
    <section aria-labelledby="em-mc" className="grid max-w-xl gap-3">
      <h2 id="em-mc" className="text-15 font-semibold text-ink">{s["mailchimp.title"]}</h2>
      <p className="text-13 text-ink-2">{s["mailchimp.help"]}</p>
      {!m && <p className="text-13 text-ink-2">{demo ? s["mailchimp.demoNote"] : s["mailchimp.notConnected"]} {!demo && <Link className="font-medium text-accent underline" href="/integrations/mailchimp">{s["mailchimp.connect"]}</Link>}</p>}
      {m && (<>
        {audiences === null && <p className="text-13 text-warn" role="status">{s["mailchimp.audiencesFailed"]}</p>}
        {audiences && (
          <div className="flex items-end gap-2">
            <Field label={s["mailchimp.audience"]} className="flex-1">{(cp) => <Select {...cp} value={aud} onValueChange={setAud} placeholder={s["mailchimp.audienceNone"]} options={audiences.map((x) => ({ value: x.id, label: `${x.name} (${fill(s["mailchimp.audienceMembers"], { count: x.members })})` }))} />}</Field>
            <Button disabled={a.pending || !aud} onClick={() => a.run(() => chooseAudience(m.id, aud))}>{s["mailchimp.audienceSave"]}</Button>
          </div>
        )}
        <h3 className="mt-2 text-14 font-semibold text-ink">{s["mailchimp.pushTitle"]}</h3>
        <p className="text-13 text-ink-2">{s["mailchimp.pushHelp"]}</p>
        <div className="flex items-end gap-2">
          <Field label={s["mailchimp.segment"]} className="flex-1">{(cp) => <Select {...cp} value={seg} onValueChange={setSeg} placeholder={s["mailchimp.segmentNone"]} options={segments.map((x) => ({ value: x.id, label: x.name }))} />}</Field>
          <Button disabled={a.pending || !seg || !m.audienceId} onClick={() => a.run(() => pushSegment(m.id, seg))}>{s["mailchimp.push"]}</Button>
        </div>
        <h3 className="mt-2 text-14 font-semibold text-ink">{s["mailchimp.hookTitle"]}</h3>
        <p className="text-13 text-ink-2">{s["mailchimp.hookHelp"]}</p>
        <div className="flex items-center gap-3">
          <Button variant="quiet" disabled={a.pending} onClick={() => a.run(async () => { const r = await createMailchimpHook(m.id); if (r.ok && r.data) setHook(r.data.url); return r; })}>{s["mailchimp.hookGenerate"]}</Button>
        </div>
        {hook && <Field label={s["mailchimp.hookTitle"]} help={s["mailchimp.hookOnce"]}><Input readOnly value={hook} onFocus={(e) => e.currentTarget.select()} /></Field>}
        <Msg m={a.msg} />
      </>)}
    </section>
  );
}
