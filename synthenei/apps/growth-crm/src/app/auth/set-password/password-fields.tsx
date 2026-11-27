"use client";
import { useState } from "react";
import { PASSWORD_MIN } from "@/lib/auth/password-policy";

/** New-password pair with a live length counter. The server action is the authority (length, deny-list, size); this only guides. */
export function PasswordFields({ fieldClass, labels }: { fieldClass: string; labels: { password: string; confirm: string; hint: string; counter: string; counterOk: string } }) {
  const [pw, setPw] = useState("");
  const n = [...pw].length, ok = n >= PASSWORD_MIN;
  const msg = (ok ? labels.counterOk : labels.counter).replace("__N__", String(n));
  return (
    <>
      <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{labels.password}</span>
        <input name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={72} required value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby="pw-hint pw-count" className={fieldClass} /></label>
      <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{labels.confirm}</span>
        <input name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={72} required className={fieldClass} /></label>
      <p id="pw-count" role="status" aria-live="polite" className={"text-[12px] " + (ok ? "text-ink-2" : "text-ink-3")}>{n === 0 ? "" : msg}</p>
      <p id="pw-hint" className="text-[12px] text-ink-3">{labels.hint}</p>
    </>
  );
}
