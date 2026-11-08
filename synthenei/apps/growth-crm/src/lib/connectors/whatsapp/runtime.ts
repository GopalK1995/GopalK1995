// Service-role wiring for the WhatsApp connector (jobs and the inbound consumer only). Server only.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { rateLimit } from "@/lib/security/rate-limit";
import { consoleLogger, vendorEnv } from "../core/runtime";
import { MEDIA_BUCKET } from "./constants";
import type { WaRuntime } from "./connector";
import { supabaseWaStore } from "./store-supabase";

type Storage = { storage: { from(b: string): { upload(path: string, body: Uint8Array, o: { contentType?: string; upsert: boolean }): PromiseLike<{ error: { message?: string } | null }> } } };

export async function whatsappRuntime(): Promise<WaRuntime> {
  const db = serviceDb();
  return {
    env: vendorEnv(),
    deps: {
      store: supabaseWaStore(db),
      log: consoleLogger("whatsapp"),
      now: () => new Date(),
      rate: async (key, limit, windowMs) => (await rateLimit("wa", key, { limit, windowMs })).ok,
      media: {
        async put(path, bytes, mime) {
          const { error } = await (db as unknown as Storage).storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
          if (error) throw new Error("media upload failed");   // detail may quote the path
        },
      },
    },
  };
}
