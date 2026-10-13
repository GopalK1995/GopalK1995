"use client";
import { useRouter } from "next/navigation";

export function RepSwitcher({ reps, value }: { reps: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-[12px] text-ink-3">
      Viewing
      <select value={value} onChange={(e) => router.push(`/sales?rep=${e.target.value}`)} className="h-9 rounded-sm border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none focus:border-ring">
        {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </label>
  );
}
