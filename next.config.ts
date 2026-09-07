import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // keep the dev-tools badge out of screen recordings
  devIndicators: false,
  // `pnpm build` sets this so it writes to .next-prod and cannot corrupt a running dev server.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};
export default nextConfig;
