import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  devIndicators: false,
  // The push service worker (public/sw.js) must never be served stale from the HTTP cache.
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
  },
  // Cache Components is off: the locale is read from a cookie in the root layout (for <html lang>),
  // which makes every route request-time anyway; all app data is fetched client-side.
  turbopack: {
    // Pin the root: the repo root has its own yarn workspace + lockfile that Next would otherwise pick.
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
