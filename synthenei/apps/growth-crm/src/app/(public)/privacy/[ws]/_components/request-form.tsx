"use client";
// Public request form. Sends only a verification link; nothing is recorded until the link is confirmed. The hidden "website" field is a
// honeypot. Errors are announced (role=alert), every field has a label, and the submit button says what it does.
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { submitRequest, type SubmitState } from "../../actions";

type S = Record<string, string>;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in v ? v[k] : m));
const PURPOSES = ["marketing_email", "whatsapp", "demo_followup", "analytics_cookies", "ai_processing"] as const;
const ERR: Record<string, string> = { email: "form.errEmail", kind: "form.errKind", details: "form.errDetails", purposes: "form.errPurposes", rate: "form.errRate", unavailable: "form.errUnavailable", unknown: "form.errUnknown" };

export function RequestForm({ workspace, org, kinds, s }: { workspace: string; org: string; kinds: string[]; s: S }) {
  const [kind, setKind] = useState("access"), [email, setEmail] = useState(""), [details, setDetails] = useState(""), [website, setWebsite] = useState("");
  const [purposes, setPurposes] = useState<string[]>([]);
  const [res, setRes] = useState<SubmitState | null>(null);
  const [pending, start] = useTransition();
  const t = (k: string, v: Record<string, string | number> = {}) => fill(s[k] ?? k, { org, ...v });

  if (res?.status === "sent") {
    return (
      <div role="status" className="grid gap-1" data-testid="request-sent">
        <h3 className="text-15 font-semibold text-ink">{t("form.sentTitle")}</h3>
        <p className="text-13 text-ink-2">{t("form.sentBody", { hours: 24 })}</p>
      </div>
    );
  }
  const err = res?.status === "error" ? res.error : null;
  const fieldErr = (f: string) => (err === f ? t(ERR[f]) : undefined);
  const toggle = (p: string) => setPurposes((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  return (
    <form className="grid gap-4" noValidate data-testid="request-form"
      onSubmit={(e) => { e.preventDefault(); start(async () => setRes(await submitRequest({ workspace, kind, email, details, purposes, website }))); }}>
      <fieldset className="grid gap-2">
        <legend className="text-13 font-medium text-ink">{t("form.kind")}</legend>
        {kinds.map((k) => (
          <label key={k} className="flex items-start gap-2 text-13 text-ink">
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-1" data-testid={`kind-${k}`} />
            <span><span className="font-medium">{t(`kind.${k}`)}</span><span className="block text-12 text-ink-3">{t(`kind.${k}.help`)}</span></span>
          </label>
        ))}
        {err === "kind" && <p role="alert" className="text-12 text-danger">{t("form.errKind")}</p>}
      </fieldset>
      <Field label={t("form.email")} help={t("form.emailHelp")} error={fieldErr("email")} required>
        <Input type="email" name="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="request-email" />
      </Field>
      {kind === "withdrawal" && (
        <fieldset className="grid gap-1.5">
          <legend className="text-13 font-medium text-ink">{t("form.purposes")}</legend>
          {PURPOSES.map((p) => (
            <label key={p} className="flex items-center gap-2 text-13 text-ink">
              <input type="checkbox" checked={purposes.includes(p)} onChange={() => toggle(p)} data-testid={`purpose-${p}`} />{t(`purpose.${p}`)}
            </label>
          ))}
          {err === "purposes" && <p role="alert" className="text-12 text-danger">{t("form.errPurposes")}</p>}
        </fieldset>
      )}
      {(kind === "correction" || kind === "grievance" || kind === "erasure" || kind === "access") && (
        <Field label={t("form.details")} help={t("form.detailsHelp")} error={fieldErr("details")}>
          <Textarea name="details" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} data-testid="request-details" />
        </Field>
      )}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>
      {(err === "rate" || err === "unavailable" || err === "unknown") && <p role="alert" className="text-13 text-danger">{t(ERR[err])}</p>}
      <div><Button type="submit" variant="primary" disabled={pending} data-testid="request-submit">{pending ? t("form.sending") : t("form.submit")}</Button></div>
    </form>
  );
}
