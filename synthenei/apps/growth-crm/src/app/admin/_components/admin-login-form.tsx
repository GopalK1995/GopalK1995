"use client";
// Two steps in one form so the password never lands in a URL: (1) email + password, (2) 6-digit TOTP code.
// Posts to BUILD's adminLogin (fields: code, next). Demo mode accepts any 6 digits.
import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, KeyRound } from "lucide-react";
import { adminLogin } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { fieldCls } from "./action-dialog";

function Verify() {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="navy" size="lg" className="w-full" disabled={pending}>{pending ? "Verifying…" : "Verify and sign in"}</Button>;
}

export function AdminLoginForm({ startOnCode, codeError, next, demo }: { startOnCode: boolean; codeError: boolean; next?: string; demo: boolean }) {
  const id = useId();
  const [step, setStep] = useState<"password" | "code">(startOnCode ? "code" : "password");
  const [email, setEmail] = useState(demo ? "vikram@synthan.example" : "");
  const [pwErr, setPwErr] = useState("");
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  const codeOk = /^\d{6}$/.test(code);

  if (step === "password") return (
    <form className="mt-6 space-y-3" noValidate onSubmit={(e) => {
      e.preventDefault();
      const pw = String(new FormData(e.currentTarget).get("password") || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setPwErr("Enter your Synthan operator email.");
      if (pw.length < 8) return setPwErr("Password is at least 8 characters.");
      setPwErr(""); setStep("code"); setTimeout(() => codeRef.current?.focus(), 0);
    }}>
      <div><label htmlFor={`${id}-e`} className="mb-1 block text-[12px] font-medium text-ink-2">Email</label>
        <input id={`${id}-e`} name="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldCls} aria-describedby={pwErr ? `${id}-err` : undefined} /></div>
      <div><label htmlFor={`${id}-p`} className="mb-1 block text-[12px] font-medium text-ink-2">Password</label>
        <input id={`${id}-p`} name="password" type="password" autoComplete="current-password" defaultValue={demo ? "demo-password" : ""} className={fieldCls} aria-describedby={pwErr ? `${id}-err` : undefined} /></div>
      {pwErr && <p id={`${id}-err`} role="alert" className="text-[12px] text-danger">{pwErr}</p>}
      <Button type="submit" variant="navy" size="lg" className="w-full">Continue</Button>
      {demo && <p className="text-[12px] text-ink-3">Demo: credentials are prefilled and not checked.</p>}
    </form>
  );

  return (
    <form action={adminLogin} className="mt-6 space-y-3">
      {next && <input type="hidden" name="next" value={next} />}
      <input type="hidden" name="email" value={email} />
      <p className="text-[13px] text-ink-2">Signing in as <span className="font-medium text-ink">{email || "your operator account"}</span></p>
      <div>
        <label htmlFor={`${id}-c`} className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-2"><KeyRound className="size-3.5" aria-hidden />6-digit code from your authenticator</label>
        <input ref={codeRef} id={`${id}-c`} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus={startOnCode}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000"
          aria-invalid={codeError && !codeOk} aria-describedby={`${id}-ch${codeError ? ` ${id}-ce` : ""}`}
          className={fieldCls + " text-center font-mono text-[20px] tracking-[0.4em]"} />
        <p id={`${id}-ch`} aria-live="polite" className="mt-1 text-[12px] text-ink-3 num">{code.length} of 6 digits</p>
        {codeError && <p id={`${id}-ce`} role="alert" className="mt-1 text-[12px] text-danger">That code was not 6 digits. Enter the current code from your authenticator.</p>}
      </div>
      {demo && <p className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3"><span className="rounded-[3px] border border-dashed border-warn/60 bg-warn-soft px-1.5 py-0.5 font-medium text-warn-ink">Demo — any 6-digit code</span>Not real MFA. Signs in as Vikram Anand (Synthan).</p>}
      <Verify />
      <button type="button" onClick={() => setStep("password")} className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" aria-hidden />Use a different account</button>
    </form>
  );
}
