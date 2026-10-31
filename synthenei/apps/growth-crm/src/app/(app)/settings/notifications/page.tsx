import { PageHeader } from "@/components/ui/misc";
import { ErrorState } from "@/components/ui/states";
import { ALL_EVENT_TYPES } from "@/lib/events/catalog";
import { fmtHHMM } from "@/lib/notify/quiet";
import { notifyRepos } from "@/lib/notify/repo";
import { quietFromPrefs } from "@/lib/notify/prefs";
import { canDo, collabCtx } from "@/lib/notify/session";
import { ctAll } from "@/lib/notify/strings";
import type { PrefRow, RuleRow } from "@/lib/notify/types";
import { NotificationSettings } from "./_components/editor";

export const metadata = { title: "Notification settings" };

export default async function NotificationSettingsPage() {
  const s = ctAll();
  const c = await collabCtx();
  const eventOptions = [...new Set(ALL_EVENT_TYPES.map((e) => e.type))].sort();
  const head = <PageHeader title={s.prefsTitle} sub={s.prefsSub} />;

  let prefs: PrefRow[] = [];
  let rules: RuleRow[] = [];
  let canManage = c.demo;
  if (!c.demo) {
    try {
      canManage = await canDo("notifications.manage");
      prefs = await notifyRepos.prefs.list(c.uid, c.ws);
      rules = canManage ? await notifyRepos.rules.list(c.ws) : [];
    } catch {
      return <>{head}<ErrorState source={s.prefsTitle} message={s.notifErrorBody} /></>;
    }
  }
  const q = quietFromPrefs(prefs);
  return (
    <>
      {head}
      <NotificationSettings prefs={prefs} quiet={q ? { from: fmtHHMM(q.start), to: fmtHHMM(q.end) } : null} rules={rules} canManage={canManage} eventOptions={eventOptions} demo={c.demo} s={s} />
    </>
  );
}
