import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  return legalMetadata("privacy");
}

export default function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
