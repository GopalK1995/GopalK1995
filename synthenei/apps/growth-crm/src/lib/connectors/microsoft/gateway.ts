// The seam between the Outlook sync / send / subscription logic and Microsoft Graph. api.ts (real Graph) and mock.ts (Showcase).
import type { RawEvent, RawMessage } from "./mappers";

export interface DeltaPage<T> { items: T[]; /** Present while more pages remain. */ next?: string; /** Present on the last page: the link for the next incremental run. */ delta?: string }
export interface GraphProfile { id: string; mail: string | null; name: string | null }
export interface SubscriptionInfo { id: string; expiresAt: string }
export interface SubscriptionRequest { resource: string; notificationUrl: string; expiresAt: string; clientState: string }

export interface GraphGateway {
  readonly kind: "api" | "mock";
  /** The signed-in user (one cheap call: verifies the token). */
  profile(): Promise<GraphProfile>;
  /** One delta page of a mail folder, receivedDateTime >= since on the first call. `link` is a next/delta link from the previous page. */
  deltaMessages(folder: "inbox" | "sent", link: string | null, sinceIso: string): Promise<DeltaPage<RawMessage>>;
  /** One delta page of the calendar view for a closed window. Times come back in UTC. */
  deltaEvents(link: string | null, window: { startIso: string; endIso: string }): Promise<DeltaPage<RawEvent>>;
  /** Null when the item no longer exists. */
  getMessage(id: string): Promise<RawMessage | null>;
  getEvent(id: string): Promise<RawEvent | null>;
  /** Plain-text mail, saved to Sent Items. Only ever called by the known-contact send path. */
  sendMail(i: { to: string[]; subject: string; body: string }): Promise<void>;
  createSubscription(i: SubscriptionRequest): Promise<SubscriptionInfo>;
  /** Throws GraphApiError(not_found) when the subscription is gone. */
  renewSubscription(id: string, expiresAt: string): Promise<SubscriptionInfo>;
  deleteSubscription(id: string): Promise<void>;
}
