# Razorpay (`razorpay`)

Payments connector: the **tenant's own Razorpay account** collects money from their customers (distinct
from Synthan's platform billing, which also uses Razorpay — see `docs/tasks/T053.md`). Payment links are
created from a server action; payment status flows back by webhook into `payments`. Source:
`src/lib/connectors/razorpay/`.

- **Auth:** `api_key`. **Gate:** `none` (no vendor review needed to use test mode).
- **Capabilities:** inbound, outbound, webhooks. **Streams:** none — events drive everything.
- **Rate:** 120 rpm, 4 retries, 500 ms–20 s backoff.
- **Env (platform):** `RAZORPAY_API_BASE` (override only; credentials are per-tenant).

## What the client must provide
The tenant pastes their own Razorpay credentials (`credentialFields`), verified with one cheap API call
(`g.probe()`) before storage:

| Field | Key | Secret | Notes |
|---|---|---|---|
| Key ID | `key_id` | no | must match `rzp_(test|live)_…` |
| Key secret | `key_secret` | yes | |
| Webhook secret | `webhook_secret` | yes | signs payment events (HMAC-SHA256) |

Optional connection setting `account_id` adds an account check. The key prefix decides the label: a
`rzp_test_…` key reports **"Test mode"**, `rzp_live_…` reports **"Live"**.

## Approvals
No Razorpay app review. To accept **real money** the tenant must have completed Razorpay's **KYC /
activation** on their own account and hold live keys. Amounts are in **INR paise** (integer); conversion
is `inr_paise_to_rupees` (`razorpay/money.ts`). GST/receipt handling is the tenant's responsibility in
their Razorpay dashboard.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`razorpay.sandbox`): *"Use Razorpay test keys (rzp_test_…) and
its published test cards. No real money moves."*

1. In the tenant's Razorpay dashboard, generate **test-mode** API keys (`rzp_test_…`) and a **webhook
   secret**.
2. Connect in the CRM with the test keys. The connection lands in `sandbox`.
3. In the Razorpay dashboard, add a webhook pointing at `/api/hooks/razorpay/<connectionId>` subscribed to
   `payment.*` / `payment_link.*` events, using the same webhook secret.
4. Create a payment link from a lead/deal, pay it with a Razorpay **test card**, and confirm the
   `payment.captured` webhook writes a `payments` row. The receiver verifies `X-Razorpay-Signature` and
   dedupes on `X-Razorpay-Event-Id`.

## Go-live flip
1. Platform sets `connector_availability` for `razorpay` to `mode = live`, `gate_status = ready` (gate is
   `none`, so nothing to approve centrally).
2. The tenant **reconnects** with **live** keys (`rzp_live_…`) and a live webhook secret.
3. Re-point / re-create the Razorpay webhook in **live mode** at the same URL with the live secret.
4. The label flips from "Test mode" to "Live"; real captures now create `payments` rows.

The sandbox↔live distinction here is driven by the **key prefix the tenant pastes**, in addition to the
platform availability gate.

## Failure modes
- **Bad keys:** `probe()` throws `CredentialError` at connect → "credentials rejected".
- **Webhook signature mismatch:** 401 at the edge (HMAC-SHA256 of raw body ≠ `X-Razorpay-Signature`);
  stored `signature_ok = false`, no body, 7 days.
- **Duplicate delivery:** Razorpay retries webhooks; dedupe on event id makes reprocessing a no-op — a
  payment is recorded exactly once.
- **Unknown/unhandled event:** parsed but ignored (`reject` reason recorded, non-fatal).
- **Test key used against live data (or vice versa):** the key prefix and the connection mode disagree; the
  label makes this visible and go-live requires a deliberate reconnect with live keys.
- **Rate limit (120 rpm):** 429s honour `Retry-After`, up to 4 retries.
