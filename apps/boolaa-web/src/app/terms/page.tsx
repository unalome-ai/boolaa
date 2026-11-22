import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/legal-page";

export async function generateMetadata({ searchParams }: PageProps<"/terms">): Promise<Metadata> {
  return legalMetadata("terms", (await searchParams).lang);
}

export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
