// Builds a Razorpay-style signed delivery for tests and Cypress fixtures: hex HMAC-SHA256(webhook secret, raw body). Not used on the receive path
// (verify/razorpay.ts verifies at the edge).
import { createHmac } from "node:crypto";

export const signRazorpayBody = (webhookSecret: string, rawBody: string): string => createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex");
