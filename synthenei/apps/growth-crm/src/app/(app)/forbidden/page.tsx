import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { requireActive } from "@/lib/auth/server";
import { HOME_FOR } from "@/lib/auth/roles";
import { pagePermission } from "@/lib/authz/pages";
import { vocabFor } from "@/lib/vertical";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("noAccess");
export default async function Forbidden({ searchParams }: { searchParams: Promise<{ page?: string; off?: string; role?: string }> }) {
  const { active } = await requireActive();
  const s = { role: active.role };
  const { page, off } = await searchParams;
  const v = vocabFor(active.tenant);
  const seg = (page ?? "this page").replace(/^\//, "").split("/")[0].replace(/-/g, " ") || "this page";
  const name = page === "/workspace" ? "that workspace (you are not a member)" : seg === "leads" ? v.nav.leads.toLowerCase() : seg === "accounts" ? v.nav.accounts.toLowerCase() : seg;
  // The exact permission the page checks (same key the route asserts). `null` = always-allowed page, `undefined` = unknown.
  const canAdmin = s.role === "owner";
  const perm = page && page !== "/workspace" ? pagePermission(page) : undefined;
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-control border border-line bg-surface p-6">
      <Lock className="size-5 text-ink-3" aria-hidden />
      <h1 className="mt-3 text-[19px] font-bold">{off ? `${name[0].toUpperCase()}${name.slice(1)} is switched off for this workspace.` : `Your role (${v.role[s.role]}) cannot open ${name}.`}</h1>
      <p className="mt-1 text-[13px] text-ink-2">{off ? canAdmin ? "Turn it back on in Settings, Configuration." : "An admin turned this module off. Ask your Owner or Admin to switch it back on in Settings." : canAdmin ? "You can change this yourself: open Access, pick this role and turn on the permission below." : `Send your Owner or Admin one line: "Please give the ${v.role[s.role]} role access to ${name}." They change it in Settings, Roles & access.`}</p>
      {!off && perm && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
          Missing permission:
          <code className="rounded-chip border border-line bg-paper-2 px-1.5 py-0.5 font-mono text-[12px] text-ink-2">{perm}</code>
        </p>
      )}
      {canAdmin && <Link href={off ? "/settings" : "/settings/roles"} className={buttonVariants({ variant: "secondary", className: "mt-5 mr-2" })}>{off ? "Open settings" : "Open Access"}</Link>}
      <Link href={HOME_FOR[s.role]} className={buttonVariants({ variant: canAdmin ? "ghost" : "primary", className: "mt-5" })}>Back to my home</Link>
    </div>
  );
}
