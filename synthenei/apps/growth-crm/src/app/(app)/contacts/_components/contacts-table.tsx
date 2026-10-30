// Server component: contacts rows with per-row edit/remove (record-level hints; the server action re-checks with assertCan).
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Table, td, th } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { Contact } from "@/lib/db/repo/types";
import type { Role } from "@/lib/data/types";
import type { Support } from "../../accounts/_components/perms";
import { verdict } from "../../accounts/_components/perms";
import type { Option } from "../../accounts/_components/record-actions";
import { at } from "../../accounts/_lib/strings";
import { DeleteContactDialog, EditContactDialog } from "./contact-dialogs";

type T = ReturnType<typeof at>;
export function ContactsTable({ rows, accounts, t, role, support, uid, showAccount = true, emptyAction }: {
  rows: Contact[]; accounts: Option[]; t: T; role: Role; support: Support; uid: string; showAccount?: boolean; emptyAction?: React.ReactNode;
}) {
  if (rows.length === 0) return <EmptyState title={t("ui.contactsEmpty")} body={t("ui.contactsEmptyHint")} action={emptyAction} />;
  const name = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "-";
  return (
    <Table minWidth={showAccount ? 720 : 560}>
      <thead><tr className="border-y border-line bg-paper/60">
        <th className={th}>{t("ui.contactName")}</th><th className={th}>{t("ui.contactRole")}</th>
        {showAccount && <th className={th}>{t("ui.contactAccount")}</th>}
        <th className={th}>{t("ui.contactPhone")}</th><th className={th}>{t("ui.contactEmail")}</th><th className={cn(th, "w-24")}><span className="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>{rows.map((c) => {
        const ctx = { role, support, uid, ownerId: c.ownerId ?? undefined };
        const ec = { id: c.id, version: c.version, fullName: c.fullName, roleTitle: c.roleTitle ?? "", email: c.email ?? "", phone: c.phone ?? "", accountId: c.accountId, isDecisionMaker: c.isDecisionMaker };
        return (
          <tr key={c.id} className="border-b border-line last:border-0 hover:bg-paper/60" data-cy="contact-row">
            <td className={cn(td, "font-medium")}>{c.fullName}{c.isDecisionMaker && <Badge tone="navy" className="ml-2">{t("ui.contactDecision")}</Badge>}</td>
            <td className={cn(td, "text-ink-2")}>{c.roleTitle ?? "-"}</td>
            {showAccount && <td className={td}>{name(c.accountId)}</td>}
            <td className={td}>{c.phone ?? "-"}</td><td className={td}>{c.email ?? "-"}</td>
            <td className={td}><span className="inline-flex gap-1">
              <EditContactDialog v={verdict("addContact", ctx)} c={ec} accounts={accounts} />
              <DeleteContactDialog v={verdict("deleteAccount", ctx)} c={ec} />
            </span></td>
          </tr>
        );
      })}</tbody>
    </Table>
  );
}
