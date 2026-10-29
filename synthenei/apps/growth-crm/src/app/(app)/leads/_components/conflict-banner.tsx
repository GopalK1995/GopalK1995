"use client";
// Shown when a write returns 409: someone else changed the record. Nothing was saved; reload fetches the latest version.
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConflictBanner({ title, body, reload, onReload }: { title: string; body: string; reload: string; onReload?: () => void }) {
  const router = useRouter();
  return (
    <div role="alert" data-cy="conflict-banner" className="flex flex-wrap items-start gap-3 rounded-sm border border-warn/50 bg-warn-soft px-3 py-2 text-[13px] text-warn-ink">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1"><p className="font-medium">{title}</p><p className="text-[12px]">{body}</p></div>
      <Button size="sm" onClick={() => { onReload?.(); router.refresh(); }}>{reload}</Button>
    </div>
  );
}
