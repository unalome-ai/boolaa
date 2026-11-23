import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { localizedUrls } from "@/lib/site";
import AndroidPage from "./view";

/**
 * /android: the signed APK download (Boolaa isn't on Google Play). Public, like /privacy and /terms
 * (open path in the proxy). Everything it shows comes from public/android/latest.json, the same
 * file the app polls for updates (src/lib/android-release.ts).
 */
export async function generateMetadata({ searchParams }: PageProps<"/android">): Promise<Metadata> {
  const [t, locale, { lang }] = await Promise.all([getTranslations("android"), getLocale(), searchParams]);
  const title = t("metaTitle");
  const description = t("metaDescription");
  return { title: { absolute: title }, description, ...localizedUrls("/android", { lang, locale, title, description }) };
}

export default function Page() {
  return <AndroidPage />;
}
