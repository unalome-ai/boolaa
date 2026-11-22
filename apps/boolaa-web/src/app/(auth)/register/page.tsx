import type { Metadata } from "next";
import { localizedUrls } from "@/lib/site";
import { getLocale, getTranslations } from "next-intl/server";
import RegisterPage from "./view";

export async function generateMetadata({ searchParams }: PageProps<"/register">): Promise<Metadata> {
  const [t, tm, locale, { lang }] = await Promise.all([getTranslations("auth"), getTranslations("meta"), getLocale(), searchParams]);
  const title = t("createAccount");
  const description = tm("description");
  return { title, description, ...localizedUrls("/register", { lang, locale, title: `${title} · Boolaa`, description }) };
}

export default function Page() {
  return <RegisterPage />;
}
