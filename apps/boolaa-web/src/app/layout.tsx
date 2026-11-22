import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { IntlClientProvider } from "@/i18n/client-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: { template: "%s · Boolaa", default: "Boolaa" },
    description: t("description"),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html lang={locale} className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <IntlClientProvider locale={locale} messages={messages}>
          {children}
        </IntlClientProvider>
      </body>
    </html>
  );
}
