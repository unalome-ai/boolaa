"use client";

import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { useState, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";

/**
 * All dates in this app are rendered in the browser (data is fetched client-side), so format them
 * in the visitor's own time zone rather than the server's.
 */
export function IntlClientProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: AbstractIntlMessages;
  children: ReactNode;
}) {
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  );
}
