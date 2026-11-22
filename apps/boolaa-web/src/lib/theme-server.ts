import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE, type Theme } from "@/lib/theme";

/** The visitor's theme choice for the server render (src/lib/theme.ts). */
export async function readTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
