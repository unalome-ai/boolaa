import type { Locale } from "@/i18n/config";
import en from "../../content/legal/en.json";
import es from "../../content/legal/es.json";
import fr from "../../content/legal/fr.json";
import it from "../../content/legal/it.json";
import ro from "../../content/legal/ro.json";

/**
 * Long-form legal text lives in content/legal/<locale>.json (not the message catalog).
 * Body items starting with "- " are bullet points; "[...]" marks a placeholder still to fill in.
 * scripts/i18n-check.mjs keeps every locale's documents and section ids in sync with English.
 */
export type LegalSection = { id: string; title: string; body: string[] };
export type LegalDoc = { title: string; intro: string; sections: LegalSection[] };
export type LegalKind = "privacy" | "terms";

const DOCS: Record<Locale, Record<LegalKind, LegalDoc>> = { en, ro, fr, es, it };

export function legalDoc(locale: Locale, kind: LegalKind): LegalDoc {
  return DOCS[locale][kind];
}
