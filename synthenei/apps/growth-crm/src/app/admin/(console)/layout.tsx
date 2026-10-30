import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/lib/auth/server";
import { SUPPORT_COOKIE, verifySupport } from "@/lib/auth/session";
import { fmtTime } from "@/lib/format";
import { AdminShell } from "../_components/admin-shell";
import { wsLabelById } from "../_components/data";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const s = await requirePlatformAdmin();
  const sup = await verifySupport((await cookies()).get(SUPPORT_COOKIE)?.value);
  const live = sup && sup.endsAt > Date.now() ? { wsLabel: (sup as { label?: string }).label ?? wsLabelById(sup.ws), mode: sup.mode, endsAtLabel: fmtTime(new Date(sup.endsAt).toISOString()) } : null;
  return <AdminShell name={s.name} email={s.email} demo={s.demo} support={live}>{children}</AdminShell>;
}
