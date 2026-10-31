"use client";
// Connection controls for one connector. Credentials are typed into a form, sent once to the server action (which hands them to
// the Vault) and cleared from state; they are never rendered back. Every control that cannot be used says why (disabled with reason).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Play, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/actions/result";
import { connectConnector, disconnectConnector, runSyncConnector, testConnector } from "./actions";

export interface PanelProps {
  connectorId: string; name: string; ws: string; connectionId: string | null; state: "idle" | "active" | "attention";
  authKind: "oauth2" | "api_key" | "service_account" | "webhook_secret" | "none"; fields: { key: string; label: string; secret: boolean }[];
  /** Why connecting is not possible right now (gate, permission, support, demo); null when it is. */
  connectBlocked: string | null; /** Why connection management (test, sync, disconnect) is not possible; null when it is. */ manageBlocked: string | null;
  labels: Record<"connect" | "authorise" | "reconnect" | "test" | "disconnect" | "runNow" | "cancel" | "disconnectTitle" | "disconnectBody" | "generic", string>;
}

export function ConnectPanel(p: PanelProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  const report = (r: ActionResult<unknown>) => {
    toast(r.message || p.labels.generic, r.sub ?? "");
    if (r.ok) { setValues({}); setErrors({}); router.refresh(); return; }
    if ("issues" in r && r.issues) setErrors(Object.fromEntries(r.issues.map((i) => [i.path, i.message])));
    router.refresh();
  };
  const run = (fn: () => Promise<ActionResult<unknown>>) => start(async () => { report(await fn()); });

  const connectNow = () => run(() => connectConnector(p.connectorId, values));
  const reconnecting = p.state === "attention";

  return (
    <div className="flex flex-col gap-4">
      {(p.state === "idle" || reconnecting) && (
        p.authKind === "oauth2" ? (
          <div>
            {p.connectBlocked
              ? <Button variant="primary" disabledReason={p.connectBlocked}><Link2 />{reconnecting ? p.labels.reconnect : p.labels.authorise}</Button>
              : <a href={`/api/oauth/${p.connectorId}/start?ws=${encodeURIComponent(p.ws)}${p.connectionId ? `&conn=${encodeURIComponent(p.connectionId)}` : ""}`} className="inline-flex"><Button variant="primary" type="button"><Link2 />{reconnecting ? p.labels.reconnect : p.labels.authorise}</Button></a>}
          </div>
        ) : (
          <form className="flex max-w-md flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (!p.connectBlocked) connectNow(); }} autoComplete="off">
            {p.fields.map((f) => (
              <Field key={f.key} label={f.label} error={errors[f.key]}>
                {(c) => <Input {...c} name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} disabled={!!p.connectBlocked || pending} />}
              </Field>
            ))}
            <div><Button type="submit" variant="primary" disabled={pending} disabledReason={p.connectBlocked ?? undefined}><PlugZap />{reconnecting ? p.labels.reconnect : p.labels.connect}</Button></div>
          </form>
        )
      )}

      {p.connectionId && p.state !== "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={pending} disabledReason={p.manageBlocked ?? undefined} onClick={() => run(() => testConnector(p.connectionId!))}><RefreshCw />{p.labels.test}</Button>
          <Button disabled={pending} disabledReason={p.manageBlocked ?? undefined} onClick={() => run(() => runSyncConnector(p.connectionId!))}><Play />{p.labels.runNow}</Button>
          {p.manageBlocked ? (
            <Button disabledReason={p.manageBlocked}><Unplug />{p.labels.disconnect}</Button>
          ) : (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Unplug />{p.labels.disconnect}</Button></DialogTrigger>
              <DialogContent title={p.labels.disconnectTitle} description={p.labels.disconnectBody}>
                <div className="mt-5 flex justify-end gap-2">
                  <DialogClose asChild><Button>{p.labels.cancel}</Button></DialogClose>
                  <Button variant="primary" disabled={pending} onClick={() => { setOpen(false); run(() => disconnectConnector(p.connectionId!)); }}>{p.labels.disconnect}</Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}
    </div>
  );
}
