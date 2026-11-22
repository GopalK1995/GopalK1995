"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "../../../../_components/actions";

export function NewTenantForm({ action }: { action: (f: FormData) => Promise<ActionResult> }) {
  const router = useRouter();
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card className="max-w-2xl">
      <CardBody>
        <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await action(fd);
            if (!r.ok) { setErr({ field: r.field, message: r.message }); return; }
            setErr(null); toast(r.message, r.sub); router.push("/admin/tenants");
          });
        }}>
          <Field label="Tenant name" error={err?.field === "name" ? err.message : undefined}><Input name="name" placeholder="Nilgiri Law Associates" required /></Field>
          <Field label="Slug" help="Lowercase, used in URLs and storage paths. Cannot be changed later." error={err?.field === "slug" ? err.message : undefined}><Input name="slug" placeholder="nilgiri-law" className="font-mono" required /></Field>
          <Field label="Brand name shown in the app" help="Defaults to the tenant name if left blank."><Input name="brand" placeholder="NILGIRI" /></Field>
          <Field label="Primary hue (0-359)" help="245 is harbour cobalt. The owner can change this in their own onboarding wizard." error={err?.field === "hue" ? err.message : undefined}><Input name="hue" type="number" min={0} max={359} defaultValue="245" /></Field>
          <Field label="First workspace" error={err?.field === "workspace" ? err.message : undefined}><Input name="workspace" placeholder="Coimbatore" required /></Field>
          <Field label="Owner email" error={err?.field === "owner" ? err.message : undefined}><Input name="owner" type="email" placeholder="owner@firm.example" required /></Field>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="submit" variant="primary" disabled={pending}>{pending ? "Creating" : "Create tenant"}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
