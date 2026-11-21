-- T042/T043: mail thread uniqueness per connection and lower-case email lookups. Additive.
create unique index if not exists conversations_ws_channel_thread
  on public.conversations (workspace_id, channel, external_thread_id) where external_thread_id is not null;
create index if not exists leads_ws_lower_email on public.leads (workspace_id, lower(email)) where email is not null;
create index if not exists contacts_ws_lower_email on public.contacts (workspace_id, lower(email)) where email is not null;
