import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import VerifyPage from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("deviceTitle"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <VerifyPage />;
}
