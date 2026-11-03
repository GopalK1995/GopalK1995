# INTEG1: integration pass

Branch feat/integ1-wiring, merged with origin/build/v1 (T024 webhooks, T030 custom fields).

Wired
- Shell: RealtimeProvider (providers.tsx), BellSlot and SyncStatusChip in the top bar.
- Nav: /notifications, /settings/notifications, /settings/roles, /settings/audit, /settings/api-keys, /settings/webhooks (permission-gated); admin shell has /admin/ops and /admin/connectors.
- Record pages: RecordCollab and PresenceFaces on lead and account detail.
- i18n namespaces registered, including fields and webhooks (en and ta).
- Job handlers: connectors/core/jobs, connectors/verify/process, connectors/all, webhooks/handler.
- piiRead passed from pageCtx to the data source.
- Real-session mappers for leads and deals (stage key from pipeline_stages, version, PII masking).
- Legacy Users tab replaced by a link to Roles & access for real sessions; demo unchanged.
- docs/migrations-backlog.md written.

Skipped
- Webhook-inbox viewer UI (needs a new read function).
- Contacts record page not given RecordCollab (not in the brief).

Checks: typecheck, lint, Vitest only. No build, no browser, no Cypress.
