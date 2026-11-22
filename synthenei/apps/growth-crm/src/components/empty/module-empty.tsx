// Designed empty states for a zero-data workspace: the generic EmptyState (components/ui/states.tsx) is the "could not
// load"/"nothing here" primitive used everywhere; these name the specific module and point at the specific next step
// (the onboarding wizard's "import" and "integration" steps use the same targets), rather than a one-size dashed box.
// Plain <a>, not next/link: this is a single navigation out of an empty module, not a prefetch-worthy hot path, and
// a plain anchor is mountable in Cypress component tests (next/link throws outside an App Router context).
import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ModuleEmptyDef { icon: LucideIcon; title: string; body: string; cta: string; href: string }

export function ModuleEmpty({ def, secondary, className }: { def: ModuleEmptyDef; secondary?: ReactNode; className?: string }) {
  const Icon = def.icon;
  return (
    <div role="status" className={`zone-decision flex flex-col items-start gap-2 rounded-control border border-dashed border-line-strong ${className ?? ""}`}>
      <Icon className="mb-1 size-5 text-ink-3" strokeWidth={1.75} aria-hidden />
      <p className="text-15 font-bold tracking-[-0.015em] text-ink">{def.title}</p>
      <p className="max-w-prose text-13 text-ink-2">{def.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a href={def.href} className={cn(buttonVariants({ variant: "primary", size: "sm" }))}>{def.cta}</a>
        {secondary}
      </div>
    </div>
  );
}

/** Fallback for a module without a designed def yet -- same shell, generic copy, never a bare "nothing here". */
export const genericEmpty = (title: string): ModuleEmptyDef => ({ icon: Inbox, title, body: "Nothing here yet.", cta: "Go to Settings", href: "/settings" });
