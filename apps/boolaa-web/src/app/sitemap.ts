import type { MetadataRoute } from "next";
import { locales } from "@/i18n/config";
import { ANDROID_RELEASE } from "@/lib/android-release";
import { LEGAL_UPDATED, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number, lastModified?: string): MetadataRoute.Sitemap[number] => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency: "monthly",
    priority,
    // The locale is chosen per visitor (cookie / Accept-Language); ?lang= links each translation.
    alternates: { languages: Object.fromEntries(locales.map((l) => [l, `${SITE_URL}${path}?lang=${l}`])) },
  });
  return [page("/", 1), page("/privacy", 0.3, LEGAL_UPDATED), page("/terms", 0.3, LEGAL_UPDATED), page("/android", 0.5, ANDROID_RELEASE.released), page("/register", 0.6), page("/login", 0.4)];
}
