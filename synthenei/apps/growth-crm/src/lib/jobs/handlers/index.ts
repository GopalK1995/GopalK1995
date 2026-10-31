// Imports every handler module so they register themselves (CONTRACTS C8.2). Later tasks add their module here
// (T024 webhooks out, T022 connectors, notifications, import); until then those kinds have no handler and retry into the DLQ.
import "./events";
import "./agent";
import "./maintenance";
import "@/lib/notify/handler"; // T027: notify.event (notification rules -> in-app rows + queued email intents)
