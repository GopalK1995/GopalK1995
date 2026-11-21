# Growth CRM: Zapier private app

Triggers (REST hooks through `POST /api/v1/webhooks`, delivered signed and retried by the CRM): New Lead, Lead Status Changed, New Deal,
Deal Stage Changed, Deal Won, Payment Received. Actions: Create Lead, Update Deal, Move Deal to Stage.

Setup (owner step, needs a Zapier account): `npm install`, `npx zapier login`, `npx zapier register "<app name>"` (writes `.zapierapprc`),
`npx zapier validate`, `npx zapier push`, `npx zapier invite <email>`. Public listing is a separate Zapier review, not done here.

Each user connects with the CRM URL and an API key from Settings > API keys. Keep the key's scopes minimal: `leads:write`, `deals:write`,
`webhooks:write`, plus read scopes for the objects triggered on (`leads:read`, `deals:read`) so the editor can fetch sample records.

`platformVersion` is read from `package.json` (`zapier-platform-core`); confirm it against the current CLI release when installing.
The definition was written to the documented Platform CLI format but has not been run through `zapier validate` (the CLI is not installed here).
