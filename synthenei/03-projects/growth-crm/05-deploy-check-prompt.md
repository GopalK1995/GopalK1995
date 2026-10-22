# Prompt: check and deploy the Growth CRM (paste into Claude Code on your laptop)

Copy everything inside the box into Claude Code, run from any folder. It needs: `git`, Node 20+ (22 preferred), the GitHub CLI (`gh`, logged in) and the Vercel CLI (`npm i -g vercel`, then `vercel login`). Do not paste tokens into the chat; log in through the CLIs.

---

```
You are checking and deploying a Next.js app to Vercel. Work step by step, report what you find at each step, and ask me before deleting anything.

## Facts
- GitHub repo: GopalK1995/GopalK1995 (private)
- Branch with the latest code: claude/inspiring-fermat-2iwd0p (latest commit should be fa5c468 or newer)
- App folder inside the repo: synthenei/apps/growth-crm   (this is the Vercel "Root Directory")
- Framework: Next.js 15 (App Router), npm, Node 22
- Vercel account: gopalk1995s-projects (Hobby)
- Vercel project to KEEP: "crm"  -> production domain https://synthanai-crm.vercel.app
- Vercel project that is BROKEN and old: "synthan-crm" (domain synthan-growth.vercel.app, every build fails in ~3s, last good code Oct 13). Do not deploy to it.
- Unrelated projects, do not touch: innovus-preview-v1, vectra.

## Routes that must work on the live site
- /g/lawsome       -> branded sign-in for the LAWSOME law-firm client; shows only LAWSOME people (Owner, Manager, Rep, Marketing, Data, Viewer)
- /g/shola-mist    -> branded sign-in for Shola Mist Guesthouse (Coonoor); green brand; shows only Kavitha Ramesh (Owner), Balamurugan S. (Reservations), Sneha Joseph (Marketing), Ramesh Iyer (Viewer)
- /g/anything-else -> 404
- /admin/login     -> super-admin sign-in; in demo mode any 6-digit code works
- /login           -> internal demo hub (all personas)
No passwords in demo mode: you click a person's name.

## Environment variables (Vercel project "crm", Production)
- If NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are NOT set: the app runs in demo mode automatically. This is what we want for the demo.
- If they ARE set: the person buttons disappear unless DEMO_MODE=1, and SESSION_SECRET (random 32+ chars) is REQUIRED. Either remove the two Supabase vars, or set DEMO_MODE=1 and SESSION_SECRET.
- DATA_SOURCE=mock (or unset).
- Never print secret values in your output; only say whether each variable is set.

## Steps
1. Clone and build locally:
   gh repo clone GopalK1995/GopalK1995 crm-check && cd crm-check
   git checkout claude/inspiring-fermat-2iwd0p && git log --oneline -3
   cd synthenei/apps/growth-crm && npm ci && npm run typecheck && npm run build
   Report: commit hash, build result. If the build fails, show the first error and stop.
2. Link to the right Vercel project (from synthenei/apps/growth-crm):
   vercel link   -> choose scope gopalk1995s-projects, project "crm" (NOT synthan-crm)
   vercel project inspect crm (or check the dashboard) and confirm:
     Root Directory = synthenei/apps/growth-crm, Framework = Next.js, Node = 22.x,
     Production Branch = claude/inspiring-fermat-2iwd0p,
     Git repo connected = GopalK1995/GopalK1995.
   Fix anything that differs (tell me what you changed).
3. Environment: `vercel env ls production` and apply the rules above.
4. Deploy production: `vercel --prod` (or redeploy the latest Ready deployment of the branch from the dashboard without build cache). Wait until it is Ready.
5. Domains: `vercel domains ls` / project Domains page. synthanai-crm.vercel.app must be attached to project "crm" and point to Production. If crm-rust-seven-79.vercel.app still exists, keep it as a redirect to synthanai-crm.vercel.app.
6. Live check (curl or a browser) on https://synthanai-crm.vercel.app :
   - /g/lawsome and /g/shola-mist return 200 and show the right people (above)
   - /g/nope returns 404
   - Sign in as Kavitha Ramesh on /g/shola-mist: pages talk about enquiries, bookings, rooms, guests; there must be NO law words (law firm, advocate, court, hearing, eCourts, Nidhi)
   - Sign in as Owner on /g/lawsome: law-firm content, no guesthouse words (Coonoor, guesthouse, check-in)
   - While signed in as Kavitha, open /?ws=lawsome-tn -> must be refused (403/forbidden), not show LAWSOME data
   - /admin/login with code 123456 -> admin console lists both tenants
   - Check the page on a phone-width window (390px): no sideways scrolling
7. Old project: ask me before deleting "synthan-crm". If I say yes: Settings -> General -> Delete Project.
8. Final report: a short table (check, result), the live URLs, and anything you changed. Do not commit or push code unless a fix is needed; if it is, commit on claude/inspiring-fermat-2iwd0p only, with a clear message, and tell me.

## Links to give the client contact afterwards
- LAWSOME: https://synthanai-crm.vercel.app/g/lawsome  (click "Owner")
- Shola Mist Guesthouse: https://synthanai-crm.vercel.app/g/shola-mist  (click "Kavitha Ramesh")
- Super admin: https://synthanai-crm.vercel.app/admin/login  (any 6-digit code in demo mode)
```

---

Notes
- Supabase project "Lawsome" (ap-southeast-1) is live and has migrations up to 0012 applied; the demo links do not need it.
- The landing page is a separate app at `synthenei/apps/lawsome-landing` (would be its own Vercel project with that Root Directory).
