"use client";
// Leads import: a button that opens the shared import wizard (src/app/(app)/import) fixed to leads. T034 replaced the old
// one-file preview dialog; the wizard handles CSV and XLSX, column mapping, duplicates, the error report and import history.
import { useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Gate } from "@/components/ui/gate";
import { useSession, useVocab } from "@/components/shell/providers";
import { ImportWizard } from "../../import/_components/import-wizard";

export function ImportDialog() {
  const t = useVocab().ls;
  const { demo } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Gate can="importCsv"><Button size="sm" onClick={() => setOpen(true)}><FileUp />{t.importBtn}</Button></Gate>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t.importTitle} description={t.importDesc} className="max-w-3xl">
          {open && <ImportWizard objects={[{ key: "lead", label: t.importConfirm }]} object="lead" demo={!!demo} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
