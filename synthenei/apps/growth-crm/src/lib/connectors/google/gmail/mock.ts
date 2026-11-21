// Showcase gateway: no network, no mailbox. Returns nothing to read (a Showcase never invents customer mail) and accepts sends silently.
import type { GmailGateway } from "./gateway";

export function makeMockGmail(): GmailGateway {
  let n = 0;
  return {
    kind: "mock",
    async profile() { return { email: "showcase@mail.invalid" }; },
    async listThreadIds() { return []; },
    async getThread() { return null; },
    async send() { return { id: `mock-sent-${++n}` }; },
  };
}
