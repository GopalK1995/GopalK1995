// Server wrapper for the top bar: <BellSlot /> loads the unread count and renders the live bell.
// If the count cannot be loaded the bell still renders (count 0) rather than breaking the shell.
import { demoNotifications } from "@/lib/notify/demo";
import { notifyRepos } from "@/lib/notify/repo";
import { collabCtx } from "@/lib/notify/session";
import { ctAll } from "@/lib/notify/strings";
import { NotificationBell } from "./notification-bell";

export async function BellSlot() {
  const c = await collabCtx();
  const s = ctAll();
  let count = 0;
  if (c.demo) count = demoNotifications(c.ws, c.uid).filter((n) => !n.readAt).length;
  else { try { count = await notifyRepos.notifications.unreadCount(c.uid, c.ws); } catch { count = 0; } }
  return <NotificationBell initialCount={count} userId={c.uid} workspaceId={c.ws} demo={c.demo} s={s} />;
}
