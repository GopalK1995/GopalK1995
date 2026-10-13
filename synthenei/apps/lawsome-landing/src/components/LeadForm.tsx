"use client";
import { useRef, useState } from "react";
import { captureUtm, track } from "@/lib/track";

const ROLES = ["Managing partner / owner", "Senior advocate / practice head", "Associate / lawyer", "Legal operations / admin", "Other"];
type Errors = Partial<Record<"name" | "email" | "firm" | "role" | "phone" | "consent", string>>;

export function LeadForm() {
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<"idle" | "sending" | "done" | "fail">("idle");
  const started = useRef(false);
  const onStart = () => { if (!started.current) { started.current = true; track("form_start"); } };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: f.get("name"), email: f.get("email"), firm: f.get("firm"), role: f.get("role"), phone: f.get("phone"), website: f.get("website"), consent: f.get("consent") === "on", utm: captureUtm() };
    const local: Errors = {};
    if (String(body.name ?? "").trim().length < 2) local.name = "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(body.email ?? "").trim())) local.email = "Please enter a valid work email.";
    if (String(body.firm ?? "").trim().length < 2) local.firm = "Please enter your law firm.";
    if (!body.role) local.role = "Please select your role.";
    if (!body.consent) local.consent = "Consent is required so we can contact you.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setState("sending");
    try {
      const r = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (r.status === 422) { setErrors(j.errors ?? {}); setState("idle"); return; }
      if (!r.ok) throw new Error();
      track("form_submit", { role: body.role });
      setState("done");
    } catch { setState("fail"); }
  }

  if (state === "done")
    return (
      <div className="success" role="status">
        <div style={{ fontSize: 34 }}>✅</div>
        <h3>Thank you — your demo request is in.</h3>
        <p style={{ color: "var(--c-ink-2)" }}>Our team will reach out within one working day to schedule your guided LAWSOME walkthrough.</p>
      </div>
    );

  return (
    <form className="form" onSubmit={onSubmit} onFocus={onStart} noValidate aria-label="Request a live demo">
      <div className="two">
        <label>Full name<input name="name" autoComplete="name" aria-invalid={!!errors.name} />{errors.name && <span className="err">{errors.name}</span>}</label>
        <label>Work email<input name="email" type="email" autoComplete="email" aria-invalid={!!errors.email} />{errors.email && <span className="err">{errors.email}</span>}</label>
      </div>
      <label>Law firm<input name="firm" autoComplete="organization" aria-invalid={!!errors.firm} />{errors.firm && <span className="err">{errors.firm}</span>}</label>
      <div className="two">
        <label>Your role<select name="role" defaultValue="" aria-invalid={!!errors.role}><option value="" disabled>Select…</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>{errors.role && <span className="err">{errors.role}</span>}</label>
        <label>Phone (optional)<input name="phone" type="tel" autoComplete="tel" aria-invalid={!!errors.phone} />{errors.phone && <span className="err">{errors.phone}</span>}</label>
      </div>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: "-9999px", height: 0, width: 0, opacity: 0 }} />
      <label className="consent"><input type="checkbox" name="consent" />
        <span>I agree that LAWSOME may contact me about a demo and process my details as described in the <a href="/privacy" style={{ textDecoration: "underline" }}>privacy notice</a>. I can withdraw consent at any time.</span></label>
      {errors.consent && <span className="err">{errors.consent}</span>}
      <button className="btn btn-primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "See LAWSOME in Action"}</button>
      {state === "fail" && <span className="err" role="alert">Something went wrong. Please try again, or email us directly.</span>}
    </form>
  );
}
