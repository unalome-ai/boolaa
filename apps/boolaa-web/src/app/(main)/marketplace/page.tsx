import type { Metadata } from "next";
import { pageUrls } from "@/lib/site";
import { getTranslations } from "next-intl/server";
import MarketplacePage from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("marketplace"), ...pageUrls("/marketplace") };
}

// Data is loaded client-side once the session + current bubble are known (see ../layout.tsx).
export default function Page() {
  return <MarketplacePage />;
}
