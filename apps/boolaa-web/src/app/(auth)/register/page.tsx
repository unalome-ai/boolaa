import type { Metadata } from "next";
import { pageUrls } from "@/lib/site";
import { getTranslations } from "next-intl/server";
import RegisterPage from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("createAccount"), ...pageUrls("/register") };
}

export default function Page() {
  return <RegisterPage />;
}
