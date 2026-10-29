# Demo vs production

Demo personas, mock data and the demo admin MFA step exist only when demo mode is on
(`demoMode` in `src/lib/env.ts`): `APP_ENV=demo`, or no Supabase env, or `DEMO_MODE=1` outside production.

- Production (`APP_ENV=production`) refuses to boot config with `DEMO_MODE=1`, and requires
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SESSION_SECRET` (32+ chars) and `JOBS_TICK_SECRET`.
- Demo deployment: a second Vercel project `synthan-crm-demo`, built from the same branch,
  with `APP_ENV=demo` and no Supabase variables (so it reads only synthetic data).
- Demo sessions always read the mock dataset and never create a Supabase client.
- Read configuration through `env` from `src/lib/env.ts`, not `process.env`.
