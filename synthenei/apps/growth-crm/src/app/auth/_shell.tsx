import Link from "next/link";
import type { ReactNode } from "react";

export const authField = "h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-[14px] outline-none placeholder:text-ink-3 focus:border-ring";

/** Shared frame for the account-lifecycle screens (invite, reset, password, MFA). */
export function AuthShell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-4 py-10">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
      {lead && <p className="mt-1 text-[13px] text-ink-2">{lead}</p>}
      <div className="mt-6">{children}</div>
      <p className="mt-8 border-t border-line pt-4 text-[12px] text-ink-3"><Link href="/login" className="font-medium text-accent hover:underline">Back to sign in</Link></p>
    </main>
  );
}

export function AuthAlert({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "info" }) {
  return <p role={tone === "danger" ? "alert" : "status"} className={tone === "danger" ? "mb-4 rounded-sm border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger" : "mb-4 rounded-sm border border-line bg-surface px-3 py-2 text-[13px] text-ink-2"}>{children}</p>;
}
