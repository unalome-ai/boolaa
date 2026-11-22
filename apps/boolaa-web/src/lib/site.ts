/** Public base URL for absolute links (Open Graph, sitemap). Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");

/** Date shown as "Last updated" on /privacy and /terms (ISO). */
export const LEGAL_UPDATED = "2026-11-22";
