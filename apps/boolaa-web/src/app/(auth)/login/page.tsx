import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import LoginPage from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signIn") };
}

export default function Page() {
  return <LoginPage />;
}
