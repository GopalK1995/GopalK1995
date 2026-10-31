// Client-safe re-export of the collab namespace helpers (no server-only imports).
export { fill, ctAll } from "@/lib/notify/strings";
export type Strings = Record<string, string>;
