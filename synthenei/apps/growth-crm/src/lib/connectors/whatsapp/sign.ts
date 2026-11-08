// Builds a Meta-style signed delivery (X-Hub-Signature-256) for tests and the Cypress fixtures. Not used on the receive path.
import { createHmac } from "node:crypto";

export const signMetaBody = (appSecret: string, rawBody: string): string => `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
