"use client";
// "Connect Instagram and Facebook": four steps, each with its real completion state, the chosen Page and Instagram names, the scopes
// granted vs requested and one plain "what to do next" line. The asset picker (choose Page) is embedded here so the whole journey
// happens on this page. All text arrives already translated; no token or secret ever reaches this component.
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Lock, type LucideIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import { AssetPicker } from "../../analytics/social/_components/asset-picker";
import type { MetaConnectModel, StepStatus } from "../_lib/meta-steps";

const LOOK: Record<StepStatus, { tone: ChipTone; Icon: LucideIcon }> = {
  done: { tone: "success", Icon: CheckCircle2 }, todo: { tone: "info", Icon: CircleDashed }, attention: { tone: "warn", Icon: AlertTriangle },
  blocked: { tone: "neutral", Icon: Lock }, pending: { tone: "neutral", Icon: Clock },
};
const NEXT_STYLE = { ok: "border-line bg-surface", action: "border-line-strong bg-paper-2", warn: "state-warn" } as const;
/** 44 px touch target on a phone, the compact 32 px control from md up. */
const tall = "h-11 md:h-8";

export interface MetaConnectLabels {
  title: string; sub: string; nextLabel: string; btnConnect: string; btnReconnect: string; btnChooseAnother: string; btnHidePicker: string; scopesHeading: string;
}
export interface MetaConnectStepsProps {
  model: MetaConnectModel; labels: MetaConnectLabels;
  connected: boolean; needsReconnect: boolean; connectionId: string | null; hasPage: boolean;
  /** OAuth start URL (carries the workspace and, for a reconnect, the connection); null when the connector cannot start OAuth. */
  connectHref: string | null;
  /** Why connecting or choosing a Page is not possible for this viewer right now (permission, support, gate); null when it is. */
  blockedReason: string | null;
  /** Used to close the picker after a new Page was saved. */
  pageKey: string | null;
}

export function MetaConnectSteps(p: MetaConnectStepsProps) {
  const [picker, setPicker] = useState(false);
  useEffect(() => { setPicker(false); }, [p.pageKey]);
  const canAct = !p.blockedReason;
  const showPicker = p.connected && canAct && p.connectionId && (!p.hasPage || picker);

  return (
    <Card data-testid="meta-connect">
      <CardHeader title={p.labels.title} sub={p.labels.sub} />
      <CardBody>
        <p role={p.model.next.tone === "warn" ? "alert" : "status"} data-testid="meta-next" className={cn("mb-4 rounded-control border px-3 py-2 text-13 text-ink", NEXT_STYLE[p.model.next.tone])}>
          <strong className="font-semibold">{p.labels.nextLabel}: </strong>{p.model.next.text}
        </p>
        <ol className="flex flex-col">
          {p.model.steps.map((step) => {
            const { tone, Icon } = LOOK[step.status];
            return (
              <li key={step.key} data-step={step.key} data-status={step.status} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
                <span className="grid size-7 place-items-center rounded-round border border-line-strong bg-surface text-12 font-semibold num text-ink">{step.n}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-13 font-semibold text-ink">{step.title}</h3>
                    <Chip tone={tone} icon={<Icon aria-hidden strokeWidth={1.75} />}>{step.statusLabel}</Chip>
                  </div>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {step.lines.map((l, i) => <li key={i} className={cn("text-13", l.bad ? "font-medium text-ink" : "text-ink-2")}>{l.text}</li>)}
                  </ul>

                  {step.key === "connect" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {p.connectHref && canAct ? (
                        <a href={p.connectHref} className={cn(buttonVariants({ variant: !p.connected || p.needsReconnect ? "primary" : "quiet" }), tall)}>{p.connected ? p.labels.btnReconnect : p.labels.btnConnect}</a>
                      ) : (
                        <Button variant="primary" className={tall} disabledReason={p.blockedReason ?? undefined}>{p.connected ? p.labels.btnReconnect : p.labels.btnConnect}</Button>
                      )}
                    </div>
                  )}
                  {step.key === "connect" && p.model.scopes.length > 0 && (
                    <details className="mt-2 text-13 text-ink-2">
                      <summary className="flex min-h-11 cursor-pointer items-center md:min-h-8">{p.labels.scopesHeading}</summary>
                      <ul className="mt-1 flex flex-col gap-1" data-testid="meta-scopes">
                        {p.model.scopes.map((sc) => (
                          <li key={sc.name} data-scope={sc.name} data-state={sc.state} className="flex flex-wrap items-center gap-2">
                            <code className="font-mono text-12 text-ink">{sc.name}</code>
                            <span className={cn("text-12", sc.state === "missing" ? "font-medium text-warn-ink" : "text-ink-3")}>{sc.label}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {step.key === "assets" && p.connected && p.hasPage && canAct && (
                    <div className="mt-3"><Button className={tall} aria-expanded={picker} onClick={() => setPicker((v) => !v)}>{picker ? p.labels.btnHidePicker : p.labels.btnChooseAnother}</Button></div>
                  )}
                  {step.key === "assets" && showPicker && <div className="mt-3" data-testid="meta-picker"><AssetPicker connectionId={p.connectionId!} embedded /></div>}
                </div>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
