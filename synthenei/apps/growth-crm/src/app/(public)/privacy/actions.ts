"use server";
// Public privacy request actions. No session: the emailed sealed link is the only credential for confirming, and the form itself only
// ever sends a link to the address typed in. Rate limits live in requestVerification / confirmRequest. Server actions export async only.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/server";
import { clientKey } from "@/lib/security/rate-limit";
import { confirmRequest, requestVerification } from "@/lib/privacy/intake";
import { getPrT } from "@/lib/privacy/strings";

export type SubmitState =
  | { status: "sent" }
  | { status: "error"; error: "email" | "kind" | "details" | "purposes" | "rate" | "unavailable" | "unknown" };

export async function submitRequest(input: { workspace: string; kind: string; email: string; details?: string; purposes?: string[]; website?: string }): Promise<SubmitState> {
  const clean = { workspace: String(input.workspace ?? "").slice(0, 60), kind: String(input.kind ?? "").slice(0, 20), email: String(input.email ?? "").slice(0, 320), details: String(input.details ?? "").slice(0, 2000), purposes: Array.isArray(input.purposes) ? input.purposes.slice(0, 10).map((p) => String(p).slice(0, 40)) : [] };
  if (String(input.website ?? "") !== "") return { status: "sent" };   // honeypot: bots fill the hidden field; they get the same answer
  if (!supabaseConfigured()) return { status: "error", error: "unavailable" };
  const { intakeDeps } = await import("@/lib/privacy/runtime");
  const { t } = await getPrT();
  const r = await requestVerification(intakeDeps(t), { ...clean, ip: clientKey(await headers()) });
  if (r.status === "sent") return { status: "sent" };
  if (r.status === "invalid") return { status: "error", error: r.field };
  if (r.status === "rate_limited") return { status: "error", error: "rate" };
  if (r.status === "unknown_workspace") return { status: "error", error: "unknown" };
  return { status: "error", error: "unavailable" };
}

/** Confirmation button on the verify page. Redirects to the same page with a non-sensitive result in the query string. */
export async function confirmVerification(slug: string, token: string): Promise<void> {
  const t = String(token).slice(0, 4096), s = String(slug).slice(0, 60);
  const base = `/privacy/${encodeURIComponent(s)}/verify/${encodeURIComponent(t)}`;
  if (!supabaseConfigured()) redirect(`${base}?r=unavailable`);
  const { intakeDeps } = await import("@/lib/privacy/runtime");
  let out: Awaited<ReturnType<typeof confirmRequest>>;
  try { out = await confirmRequest(intakeDeps(), t, clientKey(await headers())); } catch { redirect(`${base}?r=unavailable`); }
  if (out.status === "created" || out.status === "duplicate") redirect(`${base}?r=${out.status}&due=${encodeURIComponent(out.dueAt.slice(0, 10))}&k=${out.kind}${out.status === "created" && out.kind === "withdrawal" ? "&w=1" : ""}`);
  redirect(`${base}?r=${out.status}`);
}
