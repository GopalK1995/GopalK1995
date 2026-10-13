/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Parallel dev servers: NEXT_DIST_DIR=.next-<agent> npx next dev -p <port>
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
