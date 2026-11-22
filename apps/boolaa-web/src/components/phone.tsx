import { getImageProps } from "next/image";
import type { CSSProperties } from "react";
import type { Locale } from "@/i18n/config";
import { readTheme } from "@/lib/theme-server";
import { cx } from "@/lib/utils";

/**
 * Real screenshots of the iOS app, one set per language and colour scheme, in
 * public/screens/<locale>/<light|dark>/<screen>.webp. Regenerate them with
 * apps/boolaa-ios/Scripts/capture-marketing.sh.
 */
export type Screen = "home" | "chat" | "events" | "food" | "market" | "links" | "settings" | "requests" | "join" | "create" | "pending";

const WIDTH = 660;
const HEIGHT = 1435;

/**
 * A screenshot inside a generic phone frame drawn in CSS (`.phone` in globals.css). The dark
 * screenshot follows the site's theme: the visitor's choice (src/lib/theme.ts) or, for "System",
 * their OS (a <picture> source).
 * Everything is lazy-loaded except the hero (`eager`).
 */
export async function Phone({
  locale,
  screen,
  alt,
  eager = false,
  sizes = "(min-width: 1024px) 300px, 260px",
  className,
  style,
}: {
  locale: Locale;
  screen: Screen;
  /** Empty for a purely decorative phone. */
  alt: string;
  eager?: boolean;
  sizes?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const theme = await readTheme();
  const common = { alt, width: WIDTH, height: HEIGHT, sizes };
  const { props: dark } = getImageProps({ ...common, src: `/screens/${locale}/dark/${screen}.webp` });
  const imgScheme = theme === "dark" ? "dark" : "light";
  const { props: light } = getImageProps({ ...common, src: `/screens/${locale}/${imgScheme}/${screen}.webp`, loading: eager ? "eager" : "lazy" });
  return (
    <div className={cx("phone", className)} style={style} aria-hidden={alt ? undefined : true}>
      <div className="phone-screen">
        <picture>
          {theme === "system" && <source media="(prefers-color-scheme: dark)" srcSet={dark.srcSet} sizes={sizes} />}
          {/* next/image's props on a plain <img>, so <picture> can swap in the dark screenshot */}
          <img {...light} alt={alt} fetchPriority={eager ? "high" : undefined} draggable={false} />
        </picture>
        <span className="phone-island" aria-hidden />
      </div>
    </div>
  );
}
