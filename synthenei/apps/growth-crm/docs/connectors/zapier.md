# Zapier (`zapier`)

A thin catalogue entry, **not** a stored connection. Zapier has no vendor-side OAuth and no credential
stored in the CRM: the tenant creates a **scoped API key** (`/settings/api-keys`, T025) and types it into
the Zapier connection screen; triggers are **REST hooks** the Zapier app subscribes through
`POST /api/v1/webhooks` (delivered, signed and retried by the outbound webhook system, T024). Source:
`src/lib/connectors/automation/connector.ts`; the Zapier app definition lives in `integrations/*-app`.

- **Auth:** `none`. **Gate:** `none`.
- **Capabilities:** inbound + outbound (via the public API + REST hooks), no webhooks handled here, no
  streams, no pushes, nothing stored.
- **Env:** none.

## What the client must provide
A **CRM API key** they create themselves on `/settings/api-keys`, with the scopes the Zap needs
(`leads:read`, `leads:write`, …) and bound to a role. That is the only credential; it lives in Zapier, not
in this connector.

## Approvals
None from the CRM. Publishing a public Zapier integration is the integrator's Zapier-side concern; a private
Zap needs no review.

## Sandbox steps
`sandbox.supported = false`. Runbook string (`zapier.sandbox`): *"Zapier has no sandbox. Use a test Zap with
a sandbox API key; nothing reaches real customers unless a Zap sends it."*

1. Create a **test (`sk_test_…`) API key** with minimal scopes.
2. Build a test Zap: a trigger that subscribes a REST hook via `/api/v1/webhooks`, and/or an action that
   calls `/api/v1/…` with the test key.
3. Fire a CRM event and confirm the Zap receives the signed webhook; run an action and confirm it writes
   through the API under the key's role/scopes (RLS applies exactly as in the UI).

## Go-live flip
Issue a **live (`sk_live_…`) API key**, swap it into the Zap, and enable the Zap. There is no platform
availability flip to make for Zapier itself beyond leaving it enabled; the real control is the API key's
env (test vs live), scopes and role.

## Failure modes
- **Key revoked / expired / out of scope:** API and webhook-subscribe calls return `401`/`403` (problem+json)
  — see `docs/connectors/README.md` and the public API docs for the auth model.
- **Webhook endpoint failing:** the outbound delivery system retries with backoff and **auto-disables** an
  endpoint after 5 consecutive days of failure (owner notified).
- **Rate limit:** the public API enforces a per-key limit (default 120 req/min); `429` problem+json.
