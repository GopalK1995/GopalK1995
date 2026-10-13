create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  phone text,
  organisation text,
  role text,
  interest text,
  message text,
  source text default 'pitch-landing',
  utm jsonb
);
alter table public.leads enable row level security;
-- No public policies: only the server (service role) inserts via /api/leads.
