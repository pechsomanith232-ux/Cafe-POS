import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (plan §1, §9.3).
  output: "standalone",
  // E2E tests use their own build folder so they can run while `pnpm dev` is open.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  // Product images are uploaded through a server action (max 2 MB, plan §1).
  experimental: {
    serverActions: { bodySizeLimit: "3mb" },
    // Dev-only "instant navigation" checks: every page reads the login session first,
    // so validating all pages flags each one. Only segments that export `instant` are checked.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
