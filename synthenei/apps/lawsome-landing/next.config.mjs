// STATIC_EXPORT=1 next build  ->  plain static site in out/ (any static host).
// In that mode the API routes are left out (pageExtensions only picks up .tsx pages), and the
// lead form calls the Supabase submit_lead RPC from the browser (see src/lib/submitLead.ts).
const isStatic = process.env.STATIC_EXPORT === "1";

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_STATIC_EXPORT: isStatic ? "1" : "" },
  ...(isStatic ? { output: "export", trailingSlash: true, images: { unoptimized: true }, pageExtensions: ["tsx", "jsx"] } : {}),
};
