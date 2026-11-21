import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { daysLeft, dueState } from "@/lib/privacy/due";
import type { PrT } from "@/lib/privacy/strings";
import type { RequestStatus } from "@/lib/privacy/types";

/** Due date as text plus an icon, never colour alone. */
export function DueChip({ t, status, dueAt, now }: { t: PrT; status: RequestStatus; dueAt: string; now: number }) {
  const st = dueState(status, dueAt, now), d = daysLeft(dueAt, now);
  if (st === "closed") return <Chip tone="neutral" icon={<CheckCircle2 aria-hidden />} data-due="closed">{t("owner.due.closed")}</Chip>;
  const label = d < 0 ? (d === -1 ? t("owner.due.overdue1") : t("owner.due.overdue", { n: -d })) : d === 0 ? t("owner.due.today") : d === 1 ? t("owner.due.left1") : t("owner.due.left", { n: d });
  return <Chip tone={st === "overdue" ? "danger" : st === "due_soon" ? "warn" : "neutral"} icon={st === "overdue" ? <AlertTriangle aria-hidden /> : <Clock aria-hidden />} data-due={st}>{label}</Chip>;
}
