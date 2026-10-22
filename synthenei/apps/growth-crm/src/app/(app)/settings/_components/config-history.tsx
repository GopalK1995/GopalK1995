"use client";
// History and rollback. Rolling back writes the old overrides as a NEW version (nothing is deleted), and is
// authorized per changed section exactly like any other edit.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import { useCfg } from "./config-shared";

export interface HistoryRow { version: number; at: string; by: string; actor: string; reason?: string; summary: string }

export function HistorySection({ rows, version, demoNote }: { rows: HistoryRow[]; version: number; demoNote: boolean }) {
  const cfg = useCfg(), router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const rollback = (v: number) => start(async () => {
    setError(null);
    if (cfg.scope === "platform" && cfg.reason.trim().length < 8) { setError("Enter a reason of at least 8 characters above."); return; }
    const r = await cfg.actions.rollback(v, cfg.reason);
    setConfirm(null);
    if (r.ok) { toast(`Rolled back to version ${v}`, r.detail ?? cfg.savedCopy); router.refresh(); } else setError(r.message);
  });
  return (
    <Card>
      <CardHeader title="History" sub={`Every save is a version. Current version: ${version || "preset only"}.${demoNote ? " Demo: history is kept on the server until it restarts." : ""}`} />
      <CardBody>
        {error && <p role="alert" className="mb-3 text-[12px] text-danger">{error}</p>}
        {!rows.length ? <p className="flex items-center gap-2 text-[13px] text-ink-3"><History className="size-4" aria-hidden />No changes saved yet. This tenant uses its preset as is.</p> : (
          <ol className="rounded-sm border border-line">
            {rows.map((r, i) => (
              <li key={r.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2.5 last:border-b-0">
                <span className="w-10 font-mono text-[12px] text-ink-3">v{r.version}</span>
                <div className="min-w-0 flex-1 basis-56"><div className="text-[13px] text-ink">{r.summary}</div>
                  <div className="text-[12px] text-ink-3">{fmtDateTime(r.at)} · {r.by}{r.actor === "platform_admin" && " (platform)"}{r.reason ? ` · Reason: ${r.reason}` : ""}</div></div>
                {i === 0 ? <Badge tone="accent">Current</Badge> : confirm === r.version ? (
                  <span className="flex items-center gap-2"><Button size="sm" variant="primary" disabled={pending} onClick={() => rollback(r.version)}>{pending ? "Rolling back" : "Confirm rollback"}</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></span>
                ) : <Button size="sm" onClick={() => setConfirm(r.version)}>Roll back to this</Button>}
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
