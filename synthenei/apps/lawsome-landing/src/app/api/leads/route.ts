import { NextResponse } from "next/server";

const ROLES = ["Managing partner / owner", "Senior advocate / practice head", "Associate / lawyer", "Legal operations / admin", "Other"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const free = /@(gmail|yahoo|hotmail|outlook|rediffmail)\./i;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

type Body = Record<string, unknown>;
const s = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Keep only the five UTM keys, string values, 120 chars each (the DB applies the same whitelist). */
function cleanUtm(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object") return out;
  for (const k of UTM_KEYS) {
    const val = s((v as Record<string, unknown>)[k], 120);
    if (val) out[k] = val;
  }
  return out;
}

/**
 * Supabase intake: calls the SECURITY DEFINER RPC public.submit_lead with the anon (publishable) key.
 * The RPC validates again, throttles, writes leads + consent_log + lead_events, and returns only the lead id.
 * No table is readable with this key. The service-role key is an optional server-only fallback.
 */
async function submitToSupabase(lead: { name: string; email: string; organisation: string; role: string; phone: string; utm: Record<string, string> }, path: string) {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // legacy JWT keys; sb_publishable_ keys use apikey only
  const r = await fetch(`${url}/rest/v1/rpc/submit_lead`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_workspace: process.env.NEXT_PUBLIC_LEAD_WORKSPACE || process.env.LEAD_WORKSPACE || "lawsome-tn",
      p_full_name: lead.name,
      p_email: lead.email,
      p_phone: lead.phone || null,
      p_firm_name: lead.organisation,
      p_role_title: lead.role,
      p_consent_followup: true,
      p_notice_version: process.env.PRIVACY_NOTICE_VERSION || "v1",
      p_utm: lead.utm,
      p_landing_path: path,
    }),
    cache: "no-store",
  }).catch(() => null);
  if (!r) return { ok: false, status: 503 };
  if (r.ok) return { ok: true, status: 200, id: ((await r.json().catch(() => null)) as string | null) ?? undefined };
  const err = (await r.json().catch(() => ({}))) as { code?: string };
  console.error("[leads] submit_lead failed", r.status, err.code ?? "");
  return { ok: false, status: err.code === "54000" ? 429 : err.code === "22023" ? 422 : 502 };
}

export async function POST(req: Request) {
  let b: Body;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (s(b.website)) return NextResponse.json({ ok: true }); // honeypot: pretend success

  const lead = {
    name: s(b.name, 120), email: s(b.email, 160).toLowerCase(), organisation: s(b.firm, 160),
    role: s(b.role, 80), phone: s(b.phone, 30), consent: b.consent === true,
    utm: cleanUtm(b.utm), source: "lawsome-landing",
  };
  const errors: Record<string, string> = {};
  if (lead.name.length < 2) errors.name = "Please enter your name.";
  if (!EMAIL.test(lead.email)) errors.email = "Please enter a valid work email.";
  if (lead.organisation.length < 2) errors.firm = "Please enter your law firm.";
  if (!ROLES.includes(lead.role)) errors.role = "Please select your role.";
  if (lead.phone && !/^[+\d][\d\s-]{7,18}$/.test(lead.phone)) errors.phone = "Please enter a valid phone number.";
  if (!lead.consent) errors.consent = "Consent is required so we can contact you.";
  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 422 });

  const record = { ...lead, personal_email: free.test(lead.email), created_at: new Date().toISOString() };
  let path = "/";
  try { path = new URL(req.headers.get("referer") || "/", "http://x").pathname.slice(0, 300); } catch { /* keep "/" */ }

  let stored = false;
  const sb = await submitToSupabase(lead, path);
  if (sb) {
    stored = sb.ok;
    if (sb.status === 429) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const hook = process.env.LEAD_WEBHOOK_URL;
  if (hook) {
    // Routes a notification to the team (Slack / Zapier). Name, role and firm only: no email or phone in chat tools.
    const crm = process.env.CRM_BASE_URL && sb && "id" in sb && sb.id ? ` · ${process.env.CRM_BASE_URL.replace(/\/$/, "")}/leads/${sb.id}` : "";
    const ok = await fetch(hook, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `New LAWSOME demo request: ${record.name} (${record.role}) · ${record.organisation}${crm}` }),
    }).then((r) => r.ok).catch(() => false);
    stored = ok || stored;
  }
  if (!sb && !hook) console.log("[leads:demo-mode]", JSON.stringify({ ...record, email: record.email.replace(/^[^@]+/, "***"), phone: record.phone ? "***" : "" })); // no backend configured yet
  return NextResponse.json({ ok: true, stored });
}
