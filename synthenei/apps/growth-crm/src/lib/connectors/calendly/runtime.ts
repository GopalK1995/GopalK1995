// Service-role wiring for the booking connectors (webhook consumer and subscribe actions). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { consoleLogger } from "../core/runtime";
import type { BookingRuntime } from "./connector";
import { supabaseBookingStore } from "./store-supabase";

export async function bookingServiceRuntime(): Promise<BookingRuntime> {
  return { deps: { store: supabaseBookingStore(serviceDb()), log: consoleLogger("booking"), now: () => new Date() } };
}
