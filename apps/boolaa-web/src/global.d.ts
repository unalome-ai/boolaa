import type { Locale } from "@/i18n/config";
import type messages from "../messages/en.json";

// Typed message keys + locales for next-intl (en.json is the source of truth).
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
