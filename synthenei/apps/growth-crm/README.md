# LAWSOME Growth CRM (scaffold)

Internal funnel/CRM for Venket, built around the LAWSOME product only. **All data is synthetic** (`src/data/`). Plan: `../../03-projects/growth-crm/`. Schema: `supabase/schema.sql` (not applied anywhere).

```
npm install
npm run dev        # http://localhost:3100
npm run typecheck
npm run build
```

Screens (12): Funnel `/`, Leads `/leads`, Lead detail `/leads/[id]`, Pipeline, Campaigns, Audience, Channels, GA4 traffic, Tasks, Integrations, Data & backup, Settings & privacy.

Real vs mock: everything is mock. LinkedIn is shown as "Mock / CSV import". The backup monitor reads `mockBackupAdapter`; implement `BackupMonitorAdapter` in `src/lib/backup.ts` for the real thing. Event names align with `../lawsome-landing/src/lib/track.ts`. No secrets: copy `.env.example` to `.env.local` when integrations arrive.
