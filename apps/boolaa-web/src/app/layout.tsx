import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { IntlClientProvider } from "@/i18n/client-provider";
import { ThemeSync } from "@/components/theme-picker";
import { SITE_URL } from "@/lib/site";
import { THEME_COLOR } from "@/lib/theme";
import { readTheme } from "@/lib/theme-server";
import "./globals.css";

// Display face where the system has no rounded font (SF Pro Rounded is used on Apple platforms).
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin", "latin-ext"],
  weight: ["700", "800", "900"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    metadataBase: new URL(SITE_URL),
    applicationName: "Boolaa",
    title: { template: "%s · Boolaa", default: "Boolaa" },
    description: t("description"),
  };
}

/** Browser-bar colour: the chosen theme's, or one per OS scheme for "System" (src/lib/theme.ts). */
export async function generateViewport(): Promise<Viewport> {
  const theme = await readTheme();
  if (theme !== "system") return { themeColor: THEME_COLOR[theme], colorScheme: theme };
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
    ],
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, messages, theme] = await Promise.all([getLocale(), getMessages(), readTheme()]);
  // The theme is in the server-rendered HTML (no flash); "system" leaves it to prefers-color-scheme.
  return (
    <html lang={locale} data-theme={theme === "system" ? undefined : theme} className={`${nunito.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <IntlClientProvider locale={locale} messages={messages}>
          {children}
          <ThemeSync />
        </IntlClientProvider>
      </body>
    </html>
  );
}
