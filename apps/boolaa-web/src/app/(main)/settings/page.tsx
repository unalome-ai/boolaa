import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import SettingsPage from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("settings") };
}

// Data is loaded client-side once the session + current bubble are known (see ../layout.tsx).
export default function Page() {
  return <SettingsPage />;
}
