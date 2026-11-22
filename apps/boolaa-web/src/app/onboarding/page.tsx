import type { Metadata } from "next";
import { pageUrls } from "@/lib/site";
import { getTranslations } from "next-intl/server";
import OnboardingPage from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("titleFirst"), ...pageUrls("/onboarding") };
}

export default function Page() {
  return <OnboardingPage />;
}
