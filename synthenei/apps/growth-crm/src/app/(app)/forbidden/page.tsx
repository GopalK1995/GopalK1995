import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { requireActive } from "@/lib/auth/server";
import { HOME_FOR } from "@/lib/auth/roles";
import { vocabFor } from "@/lib/vertical";

export const metadata = { title: "No access" };
export default async function Forbidden({ searchParams }: { searchParams: Promise<{ page?: string; off?: string }> }) {
  const { active } = await requireActive();
  const s = { role: active.role };
  const { page, off } = await searchParams;
  const v = vocabFor(active.tenant);
  const seg = (page ?? "this page").replace(/^\//, "").split("/")[0].replace(/-/g, " ") || "this page";
  const name = page === "/workspace" ? "that workspace (you are not a member)" : seg === "leads" ? v.nav.leads.toLowerCase() : seg === "accounts" ? v.nav.accounts.toLowerCase() : seg;
  return (
    <div className="mx-auto mt-16 max-w-md rounded-md border border-line bg-surface p-6 shadow-1">
      <Lock className="size-5 text-ink-3" aria-hidden />
      <h1 className="mt-3 text-[18px] font-semibold">{off ? `${name[0].toUpperCase()}${name.slice(1)} is switched off for this workspace.` : `Your role (${v.role[s.role]}) cannot open ${name}.`}</h1>
      <p className="mt-1 text-[13px] text-ink-2">{off ? "An admin turned this module off. Ask your Owner/Admin if you need it back." : "Access is set per role in Settings → Users & roles. Ask your Owner/Admin if you need it."}</p>
      <Link href={HOME_FOR[s.role]} className={buttonVariants({ variant: "primary", className: "mt-5" })}>Back to my home</Link>
    </div>
  );
}
