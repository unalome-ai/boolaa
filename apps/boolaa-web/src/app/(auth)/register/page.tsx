import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import RegisterPage from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("createAccount") };
}

export default function Page() {
  return <RegisterPage />;
}
