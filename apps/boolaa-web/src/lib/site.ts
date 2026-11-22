import type { Metadata } from "next";

/** Production origin. Canonical and Open Graph URLs always use it, also when served from www. */
export const PRODUCTION_ORIGIN = "https://boolaa.ro";

/**
 * Public base URL for absolute links (canonical, Open Graph, sitemap). NEXT_PUBLIC_SITE_URL can
 * point a staging build elsewhere; a leading "www." is dropped so www.boolaa.ro never becomes
 * canonical.
 */
export const SITE_URL = (() => {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (!env) return PRODUCTION_ORIGIN;
  const url = new URL(env);
  url.hostname = url.hostname.replace(/^www\./, "");
  return url.origin;
})();

/**
 * Canonical + og:url for a page path (resolved against `metadataBase` = SITE_URL). A page-level
 * `openGraph` replaces the inherited one, so the shared social image is listed again here.
 */
export function pageUrls(path: string): Pick<Metadata, "alternates" | "openGraph"> {
  return {
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "Boolaa",
      url: path,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Boolaa" }],
    },
  };
}

/** Date shown as "Last updated" on /privacy and /terms (ISO). */
export const LEGAL_UPDATED = "2026-11-22";
