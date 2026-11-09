// Imports every handler module so they register themselves (CONTRACTS C8.2). Later tasks add their module here
// (T024 webhooks out, T022 connectors, notifications, import); until then those kinds have no handler and retry into the DLQ.
import "./events";
import "./agent";
import "./maintenance";
import "@/lib/notify/handler"; // T027: notify.event (notification rules -> in-app rows + queued email intents)
import "@/lib/connectors/core/jobs"; // T022: connector.scan|sync|push|refresh
import "@/lib/connectors/verify/process"; // T023: connector_inbound
import "@/lib/connectors/all"; // registers every connector module (mock is built in)
import "@/lib/connectors/email/jobs"; // T038: email.campaign | email.batch
import "@/lib/connectors/mailchimp/jobs"; // T038: mailchimp.push_segment
import "@/lib/webhooks/handler"; // T024: webhook.deliver (outbound webhooks) + webhook.housekeeping
import "./import"; // T034: import.run (CSV and XLSX import)
