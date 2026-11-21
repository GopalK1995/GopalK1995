# Growth CRM: Make custom app

Private custom app definition for Make, in the component layout of the Make Apps VS Code extension (`makecomapp.json` + one folder per
connection, webhook and module, files named `*.iml.json`).

- Connection `crm-api-key`: CRM URL + API key (Settings > API keys), checked with `GET /api/v1/me`. The key's scopes decide what is allowed.
- Instant triggers (dedicated webhooks, one per event): New Lead, Lead Status Changed, New Deal, Deal Stage Changed, Deal Won, Payment Received.
  Attach subscribes through `POST /api/v1/webhooks`, detach deletes the subscription. Deliveries are the CRM's signed, retried envelope.
- Actions: Create Lead, Update Deal, Move Deal to Stage (reads the deal's version first, as the API requires).

Install (owner step, needs a Make account): open the folder with the Make Apps extension, set the extension's API token, deploy to a new custom app.
Public listing is a separate Make review, not done here.

The definition follows the documented format but was written without a Make account and has not been imported: expect to adjust small IML details
(module `pre` request, connection `type`) on the first import. `apps.test.ts` keeps it in line with the event catalogue and the REST schemas.
