import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import SuspendedPage from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("suspended");
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

// Shown when users.status isn't active (signed in), or after sign-in was refused with
// GoTrue's `user_banned` (signed out: no reason or date available then). docs/moderation.md.
export default function Page() {
  return <SuspendedPage />;
}
