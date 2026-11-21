// Fixtures for the generic channel-manager contract. Synthetic: invented ids, names and amounts, no capture from any real partner.
// `fixtureHttp()` is a scripted stand-in for the manager's HTTP API (paged reservations, account, availability sink) used by the sandbox
// gateway and by the Vitest / Cypress specs. It never touches the network.
import type { AdapterContext } from "./types";

type Http = AdapterContext["http"];

const item = (event: string, r: Record<string, unknown>) => ({ event, reservation: r });

export const FIXTURE_ITEMS = [
  item("created", { id: "res-1001", channel: "booking_com", channel_ref: "BK-55001", check_in: "2031-03-10", check_out: "2031-03-13", room: "room-a", guests: 2, guest_name: "Test Guest One", total_minor: 1_500_000, currency: "INR", commission_pct: 15, version: 1 }),
  item("created", { id: "res-1002", channel: "makemytrip", channel_ref: "MM-77002", check_in: "2031-03-12", check_out: "2031-03-14", room: "room-b", guests: 3, guest_name: "Test Guest Two", total_minor: 900_000, currency: "INR", commission_minor: 135_000, version: 1 }),
  item("created", { id: "res-1003", channel: "airbnb", channel_ref: "HM-99003", check_in: "2031-04-01", check_out: "2031-04-05", room: "room-a", guests: 4, total_minor: 2_000_000, currency: "INR", commission_pct: 3, version: 1 }),
  item("modified", { id: "res-1001", channel: "booking_com", channel_ref: "BK-55001", check_in: "2031-03-10", check_out: "2031-03-14", room: "room-a", guests: 2, guest_name: "Test Guest One", total_minor: 2_000_000, currency: "INR", commission_pct: 15, version: 2 }),
  item("cancelled", { id: "res-1002", channel: "makemytrip", channel_ref: "MM-77002", check_in: "2031-03-12", check_out: "2031-03-14", room: "room-b", version: 2 }),
  { event: "created", reservation: { id: "res-bad", channel: "booking_com", check_in: "2031-13-40", check_out: "2031-03-14", version: 1 } },
  { nonsense: true },
];

export interface FixtureHttp extends Http { sent: { method: string; url: string; body?: unknown }[] }

/** Pages of `pageSize` items from FIXTURE_ITEMS; the cursor is the next offset as text. */
export function fixtureHttp(items: unknown[] = FIXTURE_ITEMS, pageSize = 3): FixtureHttp {
  const sent: FixtureHttp["sent"] = [];
  return {
    sent,
    async json<T>(req: { method: string; url: string; headers?: Record<string, string>; body?: unknown }): Promise<T> {
      sent.push({ method: req.method, url: req.url, body: req.body });
      const u = new URL(req.url);
      if (u.pathname.endsWith("/v1/account")) return { id: "fixture-account", name: "Fixture channel manager" } as T;
      if (u.pathname.endsWith("/v1/availability")) return {} as T;
      if (u.pathname.endsWith("/v1/reservations")) {
        const from = Number(u.searchParams.get("cursor") ?? "0") || 0;
        const page = items.slice(from, from + pageSize);
        const end = from + page.length;
        return { items: page, next_cursor: String(end), has_more: end < items.length } as T;
      }
      throw new Error(`fixture: unexpected ${req.method} ${u.pathname}`);
    },
  };
}
