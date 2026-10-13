import { NextResponse } from "next/server";

// Minimal event sink. Replace console.log with GA4/PostHog/Supabase when the stack is chosen.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("[track]", JSON.stringify(body).slice(0, 1000));
  } catch {}
  return new NextResponse(null, { status: 204 });
}
