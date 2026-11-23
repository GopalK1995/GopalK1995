# Make (`make`)

A thin catalogue entry, **not** a stored connection — identical model to Zapier. Make has no vendor-side
OAuth and no credential stored in the CRM: the tenant creates a **scoped API key**
(`/settings/api-keys`, T025) and types it into the Make connection screen; triggers are **REST hooks** the
Make app subscribes through `POST /api/v1/webhooks` (delivered, signed and retried by T024). Source:
`src/lib/connectors/automation/connector.ts`; the Make app definition lives in `integrations/*-app`.

- **Auth:** `none`. **Gate:** `none`.
- **Capabilities:** inbound + outbound (via the public API + REST hooks), no webhooks handled here, no
  streams, no pushes, nothing stored.
- **Env:** none.

## What the client must provide
A **CRM API key** created on `/settings/api-keys`, scoped to what the scenario needs and bound to a role.
That is the only credential; it lives in Make, not in this connector.

## Approvals
None from the CRM. Publishing a public Make app is the integrator's Make-side concern; a private scenario
needs no review.

## Sandbox steps
`sandbox.supported = false`. Runbook string (`make.sandbox`): *"Make has no sandbox. Use a test scenario
with a sandbox API key; nothing reaches real customers unless a scenario sends it."*

1. Create a **test (`sk_test_…`) API key** with minimal scopes.
2. Build a test scenario: a trigger subscribing a REST hook via `/api/v1/webhooks`, and/or a module calling
   `/api/v1/…` with the test key.
3. Fire a CRM event and confirm the scenario receives the signed webhook; run a module and confirm it writes
   through the API under the key's role/scopes (RLS applies exactly as in the UI).

## Go-live flip
Issue a **live (`sk_live_…`) API key**, swap it into the scenario, and enable it. As with Zapier the real
control is the API key's env, scopes and role, not a platform availability flip for Make itself.

## Failure modes
- **Key revoked / expired / out of scope:** `401`/`403` problem+json from the API and webhook-subscribe
  calls.
- **Webhook endpoint failing:** retried with backoff; **auto-disabled** after 5 consecutive days of failure
  (owner notified).
- **Rate limit:** per-key limit (default 120 req/min); `429` problem+json.
