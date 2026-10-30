// /contacts: people across all accounts. Real workspaces read the contacts repository (RLS decides what the caller may
// see; viewers without pii.read get nothing from the base table and see the masked state). Demo workspaces keep their
// contacts as leads at a firm, so this page says it is not connected there instead of showing invented rows.
import { pageCtx } from "@/lib/data/context";
import { vocabFor } from "@/lib/vertical";
import { PageHeader } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { accountsRepo } from "@/lib/db/repo/accounts";
import { contactsRepo } from "@/lib/db/repo/contacts";
import { can as engineCan } from "@/lib/authz";
import { loadPrincipal } from "@/lib/authz/load";
import type { Contact } from "@/lib/db/repo/types";
import { verdict } from "../accounts/_components/perms";
import { at } from "../accounts/_lib/strings";
import { AddContactDialog, ExportContactsButton } from "./_components/contact-dialogs";
import { ContactsTable } from "./_components/contacts-table";

const LIMIT = 100;
export async function generateMetadata() {
  const { active } = await pageCtx();
  return { title: at(vocabFor(active.tenant))("ui.pageTitle") };
}

export default async function Contacts() {
  const ctx = await pageCtx();
  const { session, active, role, support } = ctx;
  const t = at(vocabFor(active.tenant));
  const head = <PageHeader title={t("ui.pageTitle")} sub={t("ui.pageSub")} />;
  if (session.demo) return <div className="space-y-4">{head}<EmptyState title={t("ui.pageEmpty")} body={t("ui.pageNotWired")} /></div>;

  let rows: Contact[] = [], more = false, accounts: { id: string; name: string }[] = [], canUnmask = false;
  try {
    const ws = active.ws.uuid;
    const [page, accPage, principal] = await Promise.all([contactsRepo.list(ws, { limit: LIMIT }), accountsRepo.list(ws, { limit: 200 }), loadPrincipal()]);
    rows = page.rows; more = !!page.nextCursor; accounts = accPage.rows.map((a) => ({ id: a.id, name: a.name }));
    canUnmask = engineCan(principal, "pii.read");
  } catch (e) {
    console.error("[contacts page]", e);
    return <div className="space-y-4">{head}<ErrorState source={t("ui.pageTitle")} message={t("ui.pageErrorHint")} retry={<a href="/contacts"><Button size="sm">Reload</Button></a>} /></div>;
  }
  const ctxV = { role, support, uid: session.uid };
  const masked = role === "viewer";
  return (
    <div className="space-y-4">
      <PageHeader title={t("ui.pageTitle")} sub={t("ui.pageSub")}
        actions={<><ExportContactsButton v={verdict("exportCsv", ctxV)} canUnmask={canUnmask} /><AddContactDialog v={verdict("addContact", ctxV)} accounts={accounts} /></>} />
      {masked && rows.length === 0
        ? <EmptyState title={t("ui.contactsMasked")} />
        : <Card><ContactsTable rows={rows} accounts={accounts} t={t} role={role} support={support} uid={session.uid} /></Card>}
      {more && <p className="text-[12px] text-ink-3">{t("ui.pageMore", { n: LIMIT })}</p>}
    </div>
  );
}
