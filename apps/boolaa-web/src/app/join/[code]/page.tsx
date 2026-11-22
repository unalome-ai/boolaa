import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pageUrls } from "@/lib/site";
import JoinPage from "./view";

/**
 * Invite link landing (docs/boolaa-spec.md, "Invite links"). Link previews (WhatsApp, iMessage)
 * get a generic title only: the bubble's name is shown to signed-in, verified users, via
 * get_invite_preview. Never indexed.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, tm] = await Promise.all([getTranslations("invite"), getTranslations("meta")]);
  const urls = pageUrls("/join");
  return {
    title: t("title"),
    description: tm("description"),
    robots: { index: false, follow: false },
    openGraph: { ...urls.openGraph, title: `${t("title")} · Boolaa`, description: tm("description") },
  };
}

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinPage code={code} />;
}
