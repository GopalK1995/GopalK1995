import type { PermissionDef } from "../types";
const d = (key: string, description: string, o: Partial<PermissionDef> = {}): PermissionDef => { const i = key.lastIndexOf("."), resource = key.slice(0, i), action = key.slice(i + 1); return { key, resource, action, description, ...o }; };
export const PERMISSIONS: PermissionDef[] = [
  d("inbox.read", "View the inbox"),
  d("inbox.reply", "Reply in the inbox"),
  d("inbox.assign", "Assign conversations"),
  d("messages.send_whatsapp", "Send WhatsApp messages"),
  d("messages.send_email", "Send email messages"),
];
