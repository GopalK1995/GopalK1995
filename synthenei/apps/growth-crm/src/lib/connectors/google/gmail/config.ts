// Picks the Gmail gateway: Showcase mock (sandbox token / demo env, refused in production) or the real API.
import type { ConnectionSecrets } from "../../core/types";
import { baseOf, shouldMock } from "../shared/mode";
import { makeGmailApi } from "./api";
import { DEFAULT_GMAIL_API_BASE, GMAIL_ENV } from "./constants";
import type { GmailGateway } from "./gateway";
import { makeMockGmail } from "./mock";

type Env = Record<string, string | undefined>;
export interface GmailGatewayInput { secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

export function gmailGatewayFor(i: GmailGatewayInput): GmailGateway {
  if (shouldMock(i.secrets, i.env)) return makeMockGmail();
  return makeGmailApi({ base: baseOf(i.env, GMAIL_ENV.apiBase, DEFAULT_GMAIL_API_BASE), fetch: i.fetchImpl, sleep: i.sleep });
}
