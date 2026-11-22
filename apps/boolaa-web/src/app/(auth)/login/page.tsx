import type { Metadata } from "next";
import { localizedUrls } from "@/lib/site";
import { getLocale, getTranslations } from "next-intl/server";
import LoginPage from "./view";

export async function generateMetadata({ searchParams }: PageProps<"/login">): Promise<Metadata> {
  const [t, tm, locale, { lang }] = await Promise.all([getTranslations("auth"), getTranslations("meta"), getLocale(), searchParams]);
  const title = t("signIn");
  const description = tm("description");
  return { title, description, ...localizedUrls("/login", { lang, locale, title: `${title} · Boolaa`, description }) };
}

export default function Page() {
  return <LoginPage />;
}
