# Google Sheets import (`google-sheets`)

Read-only spreadsheet import: the owner pastes a spreadsheet link and a range, maps columns, and the
`import` stream feeds rows through the T034 import planner/writer (validate → dedupe → write). Optional
daily re-sync. Source: `src/lib/connectors/google/sheets/`.

- **Auth:** `oauth2` (PKCE). **Gate:** `none`.
- **Scope:** `https://www.googleapis.com/auth/spreadsheets.readonly`.
- **Capabilities:** inbound only, no webhooks. **Stream:** `import` (daily slot 03:40 IST; runs only when a
  new import is requested or scheduled re-sync is on).
- **Rate:** 60 rpm, 4 retries, 800 ms–30 s backoff.
- **Env (platform):** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (`GOOGLE_SHEETS_API_BASE`
  optional).

## What the client must provide
Nothing to paste as a secret. After OAuth, the owner provides a **spreadsheet link + range** (connection
config) and a **column→field mapping** (the field-mapping editor edits rows of object "Row":
`externalField` = column header, `localColumn` = CRM field; headers auto-map if left empty).

## Approvals
The `spreadsheets.readonly` scope is **sensitive**; the shared Google OAuth app should be verified. Gate is
`none` because the scope is read-only and a Showcase exists.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`google-sheets.sandbox`): *"Showcase reads one fictional sample
sheet. Imported sample rows are flagged as sample data."*

1. Platform sets `connector_availability` for `google-sheets` to `mode = sandbox`.
2. Connect with the Showcase token; the connector reads **one fictional sample sheet** (id `MOCK_SHEET_ID`),
   no network.
3. Run the import and confirm the sample rows land as leads/records **flagged as sample data**, and that the
   column mapping preview works.

## Go-live flip
1. Verify the OAuth app and set `connector_availability` for `google-sheets` to `mode = live`,
   `gate_status = ready`.
2. The tenant **reconnects** via real Google OAuth and pastes a real spreadsheet link + range.
3. Map columns, run the first import, and (optionally) enable daily re-sync. No webhook to configure.

## Failure modes
- **Incomplete credentials:** if `access_token` is missing, `test` throws `CredentialError` ("Google
  credentials are incomplete. Reconnect to continue.").
- **Nothing chosen yet:** connected but no spreadsheet selected → `test` returns empty (token already
  verified by the refresh path); the import no-ops until a sheet is set.
- **Bad range / unreadable rows:** rows that fail validation are counted in `rows_rejected` with PII-free
  reasons; the import continues and surfaces an error report.
- **Token refresh / revocation:** `refreshGoogleToken`, 300 s skew; dead refresh token → `needs_attention`.
- **Quota (429):** honoured with `Retry-After`, up to 4 retries.
