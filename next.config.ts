import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `pnpm build` sets this so it writes to .next-prod and cannot corrupt a running dev server.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};
export default nextConfig;
