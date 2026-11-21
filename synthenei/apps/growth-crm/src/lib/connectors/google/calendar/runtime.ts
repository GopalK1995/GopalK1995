// Service-role wiring for the calendar connector (scheduled jobs). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { consoleLogger, vendorEnv } from "../../core/runtime";
import type { CalendarRuntime } from "./connector";
import { supabaseCalendarStore } from "./store-supabase";

export async function calendarRuntimeFromService(): Promise<CalendarRuntime> {
  return { env: vendorEnv(), deps: { store: supabaseCalendarStore(serviceDb()), log: consoleLogger("google-calendar"), now: () => new Date() } };
}
