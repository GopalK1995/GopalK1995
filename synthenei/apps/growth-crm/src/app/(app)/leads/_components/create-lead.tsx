"use client";
// Create a lead (enquiry in hospitality). "Saved" only after the server commit; field errors come from the zod issues.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Gate } from "@/components/ui/gate";
import { toast } from "@/components/ui/toast";
import { useVocab } from "@/components/shell/providers";
import { lt } from "../_lib/strings";
import { field } from "../_lib/sales";
import { createLead } from "../actions";

type FieldProps = { k: string; label: string; name: string; issue?: string } & React.InputHTMLAttributes<HTMLInputElement>;
function F({ k, label, name, issue, ...p }: FieldProps) {
  return (
    <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{label}</span>
      <input name={name} className={field} aria-invalid={!!issue} aria-describedby={issue ? `cl-${k}` : undefined} {...p} />
      {issue && <span id={`cl-${k}`} className="mt-1 block text-[12px] text-danger">{issue}</span>}</label>
  );
}

export function CreateLead({ owners }: { owners: { id: string; name: string }[] }) {
  const t = lt(useVocab());
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const close = () => { setOpen(false); setErr(null); setIssues({}); };
  const submit = (f: FormData) => start(async () => {
    const owner = String(f.get("ownerId") ?? "");
    const r = await createLead({
      fullName: String(f.get("fullName") ?? ""), roleTitle: String(f.get("roleTitle") ?? ""), firmName: String(f.get("firmName") ?? ""),
      email: String(f.get("email") ?? ""), phone: String(f.get("phone") ?? ""), city: String(f.get("city") ?? ""), ownerId: owner || null,
    });
    if (!r.ok) { setErr(r.message); setIssues(Object.fromEntries((r.issues ?? []).map((i) => [i.path, i.message]))); return; }
    toast(r.message, r.sub); close(); router.refresh();
  });
  return (
    <>
      <Gate can="workLeads" showDisabled reason={t("deniedCreate")}><Button variant="primary" onClick={() => setOpen(true)} data-cy="create-lead"><Plus />{t("create.open")}</Button></Gate>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent title={t("create.title")} description={t("create.desc")}>
          <form className="space-y-3" action={submit}>
            <F k="fullName" name="fullName" label={t("create.name")} issue={issues.fullName} required maxLength={120} />
            <div className="grid grid-cols-2 gap-3">
              <F k="roleTitle" name="roleTitle" label={t("create.role")} issue={issues.roleTitle} maxLength={120} />
              <F k="firmName" name="firmName" label={t("create.firm")} issue={issues.firmName} maxLength={160} />
              <F k="phone" name="phone" label={t("create.phone")} issue={issues.phone} inputMode="tel" maxLength={20} />
              <F k="email" name="email" label={t("create.email")} issue={issues.email} type="email" maxLength={200} />
              <F k="city" name="city" label={t("create.city")} issue={issues.city} maxLength={80} />
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t("create.owner")}</span>
                <select name="ownerId" className={field} defaultValue=""><option value="">You</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            </div>
            {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
            <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" disabled={pending}>{pending ? t("create.saving") : t("create.submit")}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
