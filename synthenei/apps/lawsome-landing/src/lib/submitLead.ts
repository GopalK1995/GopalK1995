"use client";
// Lead submission. Normal builds POST to /api/leads (server route). Static exports (STATIC_EXPORT=1)
// have no server, so the browser calls the Supabase RPC public.submit_lead directly with the
// anon/publishable key — the RPC is SECURITY DEFINER, validates, throttles and returns only the lead id.
// Same payload mapping as src/app/api/leads/route.ts.

export type LeadInput = { name: string; email: string; firm: string; role: string; phone: string; website: string; consent: boolean; utm: Record<string, string> };
export type LeadResult = { ok: true } | { ok: false; status: number; errors?: Record<string, string> };

const STATIC = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

async function viaRpc(b: LeadInput): Promise<LeadResult> {
  if (b.website.trim()) return { ok: true }; // honeypot
  if (b.consent !== true) return { ok: false, status: 422, errors: { consent: "Consent is required so we can contact you." } };
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) { console.info("[leads:demo-mode] no Supabase env in this static build; request not stored"); return { ok: true }; }
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) if (typeof b.utm[k] === "string" && b.utm[k]) utm[k] = b.utm[k].slice(0, 120);
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // legacy JWT anon keys
  const r = await fetch(`${url}/rest/v1/rpc/submit_lead`, {
    method: "POST", headers,
    body: JSON.stringify({
      p_workspace: process.env.NEXT_PUBLIC_LEAD_WORKSPACE || "lawsome-tn",
      p_full_name: b.name.trim().slice(0, 120),
      p_email: b.email.trim().toLowerCase().slice(0, 160),
      p_phone: b.phone.trim().slice(0, 30) || null,
      p_firm_name: b.firm.trim().slice(0, 160),
      p_role_title: b.role.slice(0, 80),
      p_consent_followup: b.consent === true,
      p_notice_version: process.env.NEXT_PUBLIC_PRIVACY_NOTICE_VERSION || "v1",
      p_utm: utm,
      p_landing_path: window.location.pathname.slice(0, 300),
    }),
  });
  if (r.ok) return { ok: true };
  const err = (await r.json().catch(() => ({}))) as { code?: string };
  return { ok: false, status: err.code === "54000" ? 429 : err.code === "22023" ? 422 : 502 };
}

async function viaRoute(b: LeadInput): Promise<LeadResult> {
  const r = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const j = await r.json().catch(() => ({}));
  if (r.ok) return { ok: true };
  return { ok: false, status: r.status, errors: r.status === 422 ? j.errors : undefined };
}

export const submitLead = (b: LeadInput) => (STATIC ? viaRpc(b) : viaRoute(b));
