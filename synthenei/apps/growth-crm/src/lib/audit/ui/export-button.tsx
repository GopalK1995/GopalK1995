"use client";
// Export CSV button. The server action does the permission check, masking and the audit row; this only triggers a download.
import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/result";
import type { AuditExportFile } from "../actions";
import type { AuditFilters } from "../types";

export function ExportButton({ action, filters, label, workingLabel, disabledReason }: {
  action: (f: AuditFilters) => Promise<ActionResult<AuditExportFile>>; filters: AuditFilters; label: string; workingLabel: string; disabledReason?: string;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = () => start(async () => {
    setNote(null);
    const r = await action(filters);
    if (r.ok && r.data) {
      const url = URL.createObjectURL(new Blob([r.data.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = r.data.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    setNote({ ok: r.ok, text: r.sub ? `${r.message} ${r.sub}` : r.message });
  });
  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <Button variant="quiet" size="md" onClick={run} disabled={pending} disabledReason={disabledReason} data-testid="audit-export">
        <Download aria-hidden />{pending ? workingLabel : label}
      </Button>
      <p role="status" aria-live="polite" className={note ? (note.ok ? "max-w-xs text-12 text-ink-2" : "max-w-xs text-12 text-danger") : "sr-only"}>{note?.text ?? ""}</p>
    </div>
  );
}
