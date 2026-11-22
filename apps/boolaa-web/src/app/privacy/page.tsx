import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/legal-page";

export async function generateMetadata({ searchParams }: PageProps<"/privacy">): Promise<Metadata> {
  return legalMetadata("privacy", (await searchParams).lang);
}

export default function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
