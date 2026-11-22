import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { IntlClientProvider } from "@/i18n/client-provider";
import { SITE_URL } from "@/lib/site";
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

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8ff" },
    { media: "(prefers-color-scheme: dark)", color: "#15111f" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html lang={locale} className={`${nunito.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <IntlClientProvider locale={locale} messages={messages}>
          {children}
        </IntlClientProvider>
      </body>
    </html>
  );
}
