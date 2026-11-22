import Link from "next/link";
import { BubbleLogo } from "@/components/orb";
import { Fragment, type ReactNode } from "react";
import { FileWarning } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { localeNames, locales, type Locale } from "@/i18n/config";
import { legalDoc, type LegalKind } from "@/lib/legal";
import { LEGAL_UPDATED, pageUrls } from "@/lib/site";

/** Highlights "[Placeholder]" text that still has to be filled in before publishing. */
function withPlaceholders(text: string): ReactNode {
  return text.split(/(\[[^\]]+\])/g).map((part, i) =>
    /^\[[^\]]+\]$/.test(part) ? (
      <mark key={i} className="rounded bg-sunny/40 px-1 text-inherit">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Paragraphs, with runs of "- " items rendered as a bullet list. */
function Body({ items }: { items: string[] }) {
  const blocks: (string | string[])[] = [];
  for (const item of items) {
    if (item.startsWith("- ")) {
      const last = blocks.at(-1);
      if (Array.isArray(last)) last.push(item.slice(2));
      else blocks.push([item.slice(2)]);
    } else blocks.push(item);
  }
  return blocks.map((b, i) =>
    Array.isArray(b) ? (
      <ul key={i} className="my-3 list-disc space-y-1.5 pl-6 marker:text-brand-ink">
        {b.map((li, j) => (
          <li key={j}>{withPlaceholders(li)}</li>
        ))}
      </ul>
    ) : (
      <p key={i} className="my-3">
        {withPlaceholders(b)}
      </p>
    ),
  );
}

/**
 * Public, chrome-free legal page that reads well in a phone's in-app browser. `?lang=xx` (handled
 * in the proxy) picks the language; the language links keep that working without JavaScript.
 */
export async function LegalPage({ kind }: { kind: LegalKind }) {
  const locale = (await getLocale()) as Locale;
  const [t, format] = await Promise.all([getTranslations("legal"), getFormatter()]);
  const doc = legalDoc(locale, kind);
  const other: LegalKind = kind === "privacy" ? "terms" : "privacy";
  const updated = format.dateTime(new Date(`${LEGAL_UPDATED}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" });

  return (
    <div className="min-h-dvh bg-app" id="top" data-testid={`legal-${kind}`}>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="flex items-center gap-2" aria-label={t("home")}>
            <BubbleLogo size={28} animated={false} />
            <span className="font-display text-[22px] font-black tracking-tight">Boolaa</span>
          </Link>
          <nav aria-label="Language" className="flex flex-wrap gap-1 text-sm">
            {locales.map((l) => (
              <a
                key={l}
                href={`?lang=${l}`}
                hrefLang={l}
                lang={l}
                aria-current={l === locale ? "true" : undefined}
                title={localeNames[l]}
                className={`rounded-full px-2.5 py-1 font-display font-bold uppercase ${l === locale ? "bg-brand text-white" : "text-muted hover:bg-field"}`}
              >
                {l}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[44rem] px-5 pb-16 pt-6 text-[17px] leading-relaxed">
        <p role="note" className="hue-sunny mb-6 flex items-start gap-2 rounded-field bg-hue-wash px-4 py-3 text-[15px] font-medium" data-testid="legal-draft">
          <FileWarning size={20} className="mt-0.5 shrink-0 text-hue-ink" /> {t("draft")}
        </p>
        <h1 className="text-balance text-3xl font-black tracking-tight sm:text-4xl">{doc.title}</h1>
        <p className="mt-2 text-sm text-muted" data-testid="legal-updated">
          {t("lastUpdated", { date: updated })}
        </p>
        <p className="mt-5">{withPlaceholders(doc.intro)}</p>

        <nav aria-labelledby="toc-title" className="my-8 rounded-card bg-card p-5 shadow-soft">
          <h2 id="toc-title" className="mb-2 text-xs font-extrabold uppercase tracking-wide text-brand-ink">
            {t("contents")}
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-[16px] marker:text-muted">
            {doc.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="hover:text-brand-ink hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {doc.sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-6 border-t border-line pt-6 first-of-type:border-0">
            <h2 className="text-xl font-extrabold sm:text-[22px]">
              {i + 1}. {s.title}
            </h2>
            <Body items={s.body} />
          </section>
        ))}

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-sm">
          <Link href={`/${other}`} className="font-semibold text-brand-ink hover:underline">
            {t(other)}
          </Link>
          <a href="#top" className="text-muted hover:text-fg">
            {t("backToTop")} ↑
          </a>
        </div>
      </main>
    </div>
  );
}

export async function legalMetadata(kind: LegalKind) {
  const locale = (await getLocale()) as Locale;
  const doc = legalDoc(locale, kind);
  return {
    title: doc.title,
    description: doc.intro.slice(0, 160),
    openGraph: { ...pageUrls(`/${kind}`).openGraph, title: doc.title },
    alternates: {
      canonical: `/${kind}`,
      languages: Object.fromEntries(locales.map((l) => [l, `/${kind}?lang=${l}`])),
    },
  };
}
