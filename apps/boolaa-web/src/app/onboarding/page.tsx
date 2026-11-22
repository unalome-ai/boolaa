import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import OnboardingPage from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("titleFirst") };
}

export default function Page() {
  return <OnboardingPage />;
}
