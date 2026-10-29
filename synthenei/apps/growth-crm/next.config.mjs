import { withSentryConfig } from "@sentry/nextjs";
import { buildSecurityHeaders } from "./src/lib/security/headers.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Parallel dev servers: NEXT_DIST_DIR=.next-<agent> npx next dev -p <port>
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // T009: security headers (CSP report-only until verified in a browser; see src/lib/security/headers.mjs)
  async headers() {
    return [{ source: "/:path*", headers: buildSecurityHeaders(process.env) }];
  },
};

// T009: Sentry wrapper only when a DSN exists; otherwise the config is returned untouched (no-op).
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
export default dsn
  ? withSentryConfig(nextConfig, { org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, authToken: process.env.SENTRY_AUTH_TOKEN, silent: true, telemetry: false })
  : nextConfig;
