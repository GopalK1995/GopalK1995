// Public surface of the Mailchimp connector. The segment-push job handler registers from ./jobs (imported by src/lib/jobs/handlers/index.ts).
export { mailchimpConnector, audienceOf } from "./connector";
export { subscriberHash, toMember, parseWebhook, parseMembers, reasonForStatus } from "./mapping";
