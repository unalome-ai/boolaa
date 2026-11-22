import type { Metadata } from "next";
import { pageUrls } from "@/lib/site";
import { getTranslations } from "next-intl/server";
import LoginPage from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signIn"), ...pageUrls("/login") };
}

export default function Page() {
  return <LoginPage />;
}
