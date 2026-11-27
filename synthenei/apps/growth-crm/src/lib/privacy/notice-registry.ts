// The notice a workspace is publishing right now, as consent rows cite it: its version label and the hash of its text.
// Server only. Registering the text is what makes the hash on a consent row mean something (notice_versions, migration 0032).
import "server-only";
import type { Db } from "@/lib/db/client";
import { registerNotice } from "./consent-write";
import { noticeSnapshot } from "./evidence";
import { makePrT } from "./strings";
import { supabaseIntakeStore } from "./store-supabase";

export interface CurrentNotice { version: string; sha256: string | null }

/** Null when the workspace cannot be read. sha256 is null while notice_versions does not exist yet (0032 pending). */
export async function currentNotice(svc: Db, wsUuid: string): Promise<CurrentNotice | null> {
  try {
    const w = await supabaseIntakeStore(svc).workspaceById(wsUuid);
    if (!w) return null;
    const snap = noticeSnapshot(w, makePrT("en"));
    return { version: snap.version, sha256: (await registerNotice(svc, w.tenantUuid, snap)) === "ok" ? snap.sha256 : null };
  } catch { return null; }
}
