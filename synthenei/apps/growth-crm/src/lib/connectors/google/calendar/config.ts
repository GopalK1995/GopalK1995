// Picks the calendar gateway: Showcase mock (sandbox token / demo env, refused in production) or the real API.
import type { ConnectionSecrets } from "../../core/types";
import { baseOf, shouldMock } from "../shared/mode";
import { makeCalendarApi } from "./api";
import { CALENDAR_ENV, DEFAULT_CALENDAR_API_BASE } from "./constants";
import type { CalendarGateway } from "./gateway";
import { makeMockCalendar } from "./mock";

type Env = Record<string, string | undefined>;
export interface CalendarGatewayInput { secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

export function calendarGatewayFor(i: CalendarGatewayInput): CalendarGateway {
  if (shouldMock(i.secrets, i.env)) return makeMockCalendar();
  return makeCalendarApi({ base: baseOf(i.env, CALENDAR_ENV.apiBase, DEFAULT_CALENDAR_API_BASE), fetch: i.fetchImpl, sleep: i.sleep });
}
