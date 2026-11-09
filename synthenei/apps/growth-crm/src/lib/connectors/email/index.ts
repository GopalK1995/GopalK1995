// Public surface of the email connector. Job handlers register from ./jobs (imported by src/lib/jobs/handlers/index.ts), not from here,
// so importing the connector defs (connectors/all.ts) has no queue side effects.
export { resendConnector, smtpConnector, setEmailRuntimeFactory, refreshDomainState, emailRuntime } from "./connector";
export type { EmailRuntime } from "./connector";
export { sendEmail, dispatchMessage, dispatchQueued, sendTemplateBatch, compose } from "./send";
export { suppressAddress } from "./withdraw";
export { renderMerge, mergeFieldsOf, escapeHtml } from "./merge";
export { signUnsubscribe, verifyUnsubscribe } from "./unsubscribe";
export { isShowcase } from "./config";
export { MOCK_API_KEY } from "./constants";
