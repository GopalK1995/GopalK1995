# Gate 5: Batch 5 integration (T041 to T050 except T048), 21 Nov 2026

Database: Supabase project Lawsome `evybdanqxgkjoybrvzru` (real, no local DB). Branch `build/v1`.

## Verdict
| Check | Result |
|---|---|
| Migrations 0022h to 0022n applied and committed | PASS (additive, idempotent; ga4_daily 4,320 rows and 6 invitations untouched) |
| Supabase advisors before/after | PASS: security identical (67 / 11 / 1 / 4 / 42, all already documented in advisors.md); performance only new `unused_index` INFO on the 14 new indexes (fresh tables) |
| `tsc --noEmit` | PASS |
| `eslint .` | PASS (0 errors, 103 pre-existing warnings) |
| Vitest, full (Node 22) | PASS 150 files, 2272 tests (run before the glue); connectors + api re-run after the glue: 65 files, 1103 tests pass. `fields.test.tsx` did not flake |
| Cypress, `next build`, pgTAP | NOT RUN (brief) |
| Any connector against its real vendor | NOT DONE: no vendor credentials exist; everything is fixture / Showcase tested |

## Migrations applied (names as in Lawsome and in supabase/migrations/)
0022h event types (booking.created / cancelled / unmatched, lead.sla_breached); 0022i `linkedin_assets` + campaigns index; 0022j `reviews` reply columns + `gbp_daily` (tenant trigger, `private.rls_table` select for `analytics.read`, writes service role only); 0022k `ical_feeds` and `ical_export_tokens` (column-level grants hide `url_secret_id` and `token_hash`); 0022l conversation thread unique index and lower(email) indexes; 0022m connector catalogue + availability; 0022n booking field_defs (no-op today: no `booking` object type exists in this project, so nothing seeded; `seed_hospitality_booking` still needs the same fields folded in).
Existing availability rows changed on purpose: `cal-com`, `zapier`, `make` were `live/ready` and are now not live (see below). The 9 existing connections of calendly/make/zapier are all `showcase` status, so no working connection was affected.

## True gate state per connector (production / staging / demo)
Rule applied: nothing is `live`; production is `disabled`; staging and demo are `sandbox` only where a Showcase or fixture gateway ships.
| Connector | Gate | prod / staging / demo | What is really missing |
|---|---|---|---|
| linkedin | needs_vendor_approval | disabled / disabled / disabled | LinkedIn Marketing Developer Platform approval, client id and secret; no sandbox |
| google-business | needs_vendor_approval | disabled / sandbox / sandbox | Google must grant Business Profile API access per Cloud project; OAuth verification |
| google-calendar | needs_vendor_approval | disabled / sandbox / sandbox | Google OAuth app verification (sensitive scope). The backlog suggested live/none; not applied because it has never run against Google |
| gmail | needs_vendor_approval | disabled / sandbox / sandbox | Restricted scope: testing mode (100 named users) or CASA; tenant opt-in |
| outlook | needs_vendor_approval | disabled / sandbox / sandbox | Entra app, publisher verification, admin consent route |
| slack | needs_client_credentials | disabled / sandbox / sandbox | Slack app client id, secret, signing secret |
| calendly | none (PAT) | disabled / sandbox / sandbox | Built to vendor docs, never run with a real token; webhooks need a paid Calendly plan |
| cal-com | none (API key) | disabled / sandbox / sandbox | Same: untested with a real key |
| ical | none | disabled / sandbox / sandbox | Untested against real Airbnb / Booking.com feeds; needs the new /api/ical route deployed publicly |
| channel-manager | needs_vendor_approval | disabled / sandbox / sandbox | Partner not chosen (B-6); generic adapter and fixtures only |
| zapier, make | gate_status ready, sandbox unsupported | disabled everywhere | Apps never pushed / imported / published. Platform REST API keys and webhooks work today |

## Glue wired (small, typechecked)
- `api/oauth/[connector]/start`: **fixed a real gate bypass.** The generic route sent Gmail's restricted `gmail.readonly` scope to Google with no opt-in (runtime refused to use it, but the consent screen asked for it). Gmail now goes through `startGmailConnect` (both acknowledgements via `ack_restricted=1&ack_test_user=1`, testing mode or CASA, audit row); closed gate = no consent screen.
- `api/oauth/[connector]/callback`: `google-calendar` and `gmail` use `connectGoogleUser` (per-user grants); Gmail stamps `gmail_opt_in` only if the gate is still open.
- `api/ical/[token]` (GET only, per-IP rate limit, uniform 404, 405 otherwise; `api/` is outside the auth middleware on purpose).
- `verify/index.ts`: `channel-manager` uses the Standard Webhooks scheme (secret = connection `webhook_secret`).
- `integrations/_components/batch5-actions.ts`: server actions for LinkedIn, Slack (list, select, test), GBP, Outlook subscribe, iCal feeds and tokens. All start with `manageCtx()` (`integrations.manage`, support sessions blocked), reject demo, validate ids with zod, audit as the signed-in user.
- `.env.example` already carried every name and redirect URI from the task reports (checked, nothing to add).

## Secrets and vault review
- No token, secret or feed URL is logged (grep of `console.*` in connectors and ai found none). Tokens live in the Vault bundle; iCal feed URL in the Vault (`url_secret_id`, hidden by column grants); export tokens stored as SHA-256 only; Slack channel and Meta/LinkedIn secrets in bundles.
- Column grants verified in the migration: `authenticated` cannot read `url_secret_id` or `token_hash`.
- Vendor 429 / Retry-After handling is shared in `connectors/core/http.ts` (covered by existing tests). Not exercised against a real vendor.
- `sync_runs` human-readable errors: spot-checked in unit tests only. UNVERIFIED in a browser.

## AI cap bypass review
- Single entry: all provider calls (anthropic, google, openai) are reached only through `lib/ai/gateway.ts`; no other file calls a vendor AI host. Order is feature switch, provider allow-list, caps (fail closed on a missing answer), redaction, key, call, usage + audit. Nothing accepts caps, keys or models from a client.
- `ai_usage` is deny-all RLS (no policy), so a client cannot insert, delete or reset usage; caps come from `ai_cap_status()` which checks tenant membership.
- Residual: check-then-act. Usage is written after the call, so N concurrent calls can overshoot a cap by up to N. Low risk, not fixed (needs a reservation row).
- Residual: `ai_cap_status(p_tenant, p_user)` lets any member read another member's call count in the same tenant. Counts only, no content.
- Prompts: core PII redaction always on, extended per tenant policy; audit stores the redacted prompt. Not tested with real PII corpora.

## Open items
1. Owner steps to leave the gates: Slack app, Google OAuth verification + Business Profile access request, Entra publisher verification, LinkedIn approval, Zapier push, Make import, channel manager choice (B-6).
2. No UI yet for: LinkedIn/Slack/GBP/Outlook selection, iCal feeds and tokens, Gmail opt-in checkbox (start route needs the two `ack_*` query params), Outlook admin-consent route, Calendly/Cal.com webhook subscribe on connect. The actions exist; nav and PAGE_PERMISSION entries were not added because no page exists.
3. Calendly / Cal.com `subscribe*` after `connectWithCredentials` is not wired (needs the connect action to branch); until then those two connectors only work in Showcase.
4. Slack `url_verification` handshake is still not answered by the webhook receiver; `lead.sla_breached` is registered but nothing emits it.
5. `seed_hospitality_booking` does not yet create the extra Booking fields (0022n only covers existing booking types).
6. Cypress specs for ical / channel-manager / GBP need `CYPRESS_*` env and a running app: not run. `next build` and pgTAP not run.
7. Carried from gate 4: ga4_daily primary key swap, stage required_fields enforcement, 7-day inbox purge.
