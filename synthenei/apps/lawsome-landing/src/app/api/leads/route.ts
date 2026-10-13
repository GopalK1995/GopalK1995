import { NextResponse } from "next/server";

const ROLES = ["Managing partner / owner", "Senior advocate / practice head", "Associate / lawyer", "Legal operations / admin", "Other"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const free = /@(gmail|yahoo|hotmail|outlook|rediffmail)\./i;

type Body = Record<string, unknown>;
const s = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function POST(req: Request) {
  let b: Body;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (s(b.website)) return NextResponse.json({ ok: true }); // honeypot: pretend success

  const lead = {
    name: s(b.name, 120), email: s(b.email, 160).toLowerCase(), organisation: s(b.firm, 160),
    role: s(b.role, 80), phone: s(b.phone, 30), consent: b.consent === true,
    utm: typeof b.utm === "object" && b.utm ? b.utm : {}, source: "lawsome-landing",
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
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, hook = process.env.LEAD_WEBHOOK_URL;
  let stored = false;

  if (url && key) {
    const { consent: _c, personal_email: _p, ...row } = record;
    const r = await fetch(`${url}/rest/v1/leads`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ name: row.name, email: row.email, organisation: row.organisation, role: row.role, phone: row.phone || null, source: row.source, utm: row.utm }),
    });
    stored = r.ok;
    if (!r.ok) console.error("[leads] supabase insert failed", r.status);
  }
  if (hook) {
    // Routes the lead to the designated team (Slack / Zapier / email-to-CRM webhook).
    stored = (await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `New LAWSOME demo request: ${record.name} (${record.role}) · ${record.organisation} · ${record.email}${record.phone ? " · " + record.phone : ""}`, lead: record }) }).then((r) => r.ok).catch(() => false)) || stored;
  }
  if (!url && !hook) console.log("[leads:demo-mode]", JSON.stringify(record)); // no backend configured yet
  return NextResponse.json({ ok: true, stored });
}
