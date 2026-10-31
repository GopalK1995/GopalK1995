// STUB. Real sending (Resend, templates, DKIM) arrives in T038. Until then nothing is ever delivered by email:
// the notify handler records `email: "queued"` on the notification and never claims delivery.
export interface EmailMessage { to: string; subject: string; text: string; deliverAfter?: string; dedupe: string }
export type EmailResult = { status: "queued" } | { status: "sent"; providerId: string } | { status: "failed"; reason: string };
export interface EmailSender { send(msg: EmailMessage): Promise<EmailResult> }

/** Default sender: accepts the message and reports it as queued. T038 replaces this with the Resend sender. */
export const stubEmailSender: EmailSender = { async send() { return { status: "queued" }; } };
let current: EmailSender = stubEmailSender;
export const setEmailSender = (s: EmailSender) => { current = s; };
export const getEmailSender = () => current;
