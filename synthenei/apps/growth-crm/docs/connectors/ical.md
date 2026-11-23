# Calendar feeds (iCal) (`ical`)

Generic read-only iCal fallback for hospitality availability: a 30-minute poll fetches each subscribed
`.ics` feed and reconciles **Booking** records. No vendor approval and no pasted credentials — the
connection exists only so the poll, `sync_runs` history and `needs_attention` state behave like every other
connector. The calendar links themselves are rows in `ical_feeds` (URL stored in the Vault), added through
`manage.ts`. Source: `src/lib/connectors/ical/`.

- **Auth:** `api_key` with **no** `credentialFields` (nothing to paste at connect). **Gate:** `none`.
- **Capabilities:** inbound only, no webhooks, no outbound.
- **Stream:** `import` (every 30 min).
- **Rate:** 30 rpm, 1 retry, 500 ms–5 s backoff.

## What the client must provide
No credential at connect. After connecting, the tenant adds one or more **public `.ics` calendar URLs**
(e.g. an Airbnb or Booking.com export link). URLs are SSRF-checked (`ssrf.ts`) and stored in the Vault. A
`timezone` connection setting controls date maths.

## Approvals
None. iCal feeds are read-only public URLs; there is nothing to approve.

## Sandbox steps
`sandbox.supported = false`. Runbook string (`ical.sandbox`): *"No sandbox: iCal feeds are read-only. Paste
a calendar link and the dates appear as bookings within 30 minutes."*

To rehearse: add a throwaway public `.ics` URL and confirm its events appear as bookings within one poll
cycle. There is no mock transport because the feed itself is harmless (read-only, no customer contact).

## Go-live flip
Platform sets `connector_availability` for `ical` to `mode = live` / `gate_status = ready`; the tenant adds
the real feed URLs. Because the connector never contacts a customer, "sandbox vs live" is effectively just
which feed URLs are attached.

## Failure modes
- **A feed URL stops working:** `test` probes each feed and throws `CredentialError` ("A calendar link no
  longer works") → `needs_attention`; a successful `test` resets the failure counters so the connection can
  resume.
- **Unparseable feed or event:** counted as `rows_rejected` (`feed_or_event_rejected`); other feeds still
  import; `failedFeeds` is reported in the sample.
- **SSRF / private URL:** blocked at add time by `ssrf.ts`.
- **Rate limit / slow host:** 1 retry only (short backoff); a persistently failing feed trips the failure
  counter.
