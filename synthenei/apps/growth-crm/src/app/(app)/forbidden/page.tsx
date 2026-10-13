import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { requireActive } from "@/lib/auth/server";
import { HOME_FOR, ROLE_LABEL } from "@/lib/auth/roles";

export const metadata = { title: "No access" };
export default async function Forbidden({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { active } = await requireActive();
  const s = { role: active.role };
  const { page } = await searchParams;
  const name = page === "/workspace" ? "that workspace (you are not a member)" : (page ?? "this page").replace(/^\//, "").split("/")[0].replace(/-/g, " ") || "this page";
  return (
    <div className="mx-auto mt-16 max-w-md rounded-md border border-line bg-surface p-6 shadow-1">
      <Lock className="size-5 text-ink-3" aria-hidden />
      <h1 className="mt-3 text-[18px] font-semibold">Your role ({ROLE_LABEL[s.role]}) cannot open {name}.</h1>
      <p className="mt-1 text-[13px] text-ink-2">Access is set per role in Settings → Users &amp; roles. Ask your Owner/Admin if you need it.</p>
      <Link href={HOME_FOR[s.role]} className={buttonVariants({ variant: "primary", className: "mt-5" })}>Back to my home</Link>
    </div>
  );
}
