// Shared types for the API keys screen ("use server" files may export only async functions, so types live here).
export interface IssuedKey { id: string; name: string; secret: string; prefix: string; env: "live" | "test" }
