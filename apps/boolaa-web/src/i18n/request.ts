import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";

// "Without i18n routing": no locale in the URL; it comes from the cookie / Accept-Language.
export default getRequestConfig(async () => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get("accept-language"));
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
