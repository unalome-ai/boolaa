"use client";

import Link from "next/link";
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Copy, Download, Globe, ShieldCheck, Smartphone, Store } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { AmbientBackdrop, BubbleLogo, Mascot } from "@/components/orb";
import { StoreButton } from "@/components/store-button";
import { localeNames, locales } from "@/i18n/config";
import { CompactLocalePicker } from "@/i18n/locale-picker";
import { ANDROID_RELEASE as release } from "@/lib/android-release";
import { APP_STORE_URL } from "@/lib/site";

const MB = 1024 * 1024;

/**
 * Public APK download page (docs/boolaa-spec.md, "Android distribution"). Chrome-free like the legal
 * pages, so it reads well in a phone's browser; the mascot and a sticker label as on the landing
 * (docs/design-system.md §8.4, §8.5). Every value comes from public/android/latest.json.
 */
export default function AndroidPage() {
  const t = useTranslations("android");
  const tl = useTranslations("landing");
  const tg = useTranslations("legal");
  const format = useFormatter();
  const locale = useLocale();
  // ISO date only: format it in UTC so server and browser render the same day.
  const date = format.dateTime(new Date(`${release.released}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" });
  const size = release.size > 0 ? format.number(release.size / MB, { maximumFractionDigits: 1 }) : null;
  const path = (chunks: ReactNode) => <span className="whitespace-normal rounded-md bg-field px-1.5 py-0.5 font-semibold text-fg">{chunks}</span>;

  return (
    <div className="hue-mint min-h-dvh bg-app" data-testid="android-page">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="flex items-center gap-2" aria-label={tg("home")}>
            <BubbleLogo size={28} animated={false} />
            <span className="font-display text-[22px] font-black tracking-tight">Boolaa</span>
          </Link>
          <CompactLocalePicker />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-16 pt-6">
        {/* Hero: mascot, title and the download button */}
        <section className="relative isolate overflow-clip rounded-hero px-6 py-10 text-center shadow-soft sm:px-10 sm:py-12">
          <AmbientBackdrop className="-z-10" count={8} />
          <Mascot expression="cheering" hue="mint" size={112} className="mx-auto" />
          <p className="mt-4">
            <span className="sticker hue-mint" style={{ "--tilt": "-2deg" } as CSSProperties} data-testid="android-sticker">
              {t("sticker")}
            </span>
          </p>
          <h1 className="screen-title mt-3 text-balance">{t("title")}</h1>
          <p className="mx-auto mt-3 max-w-lg text-pretty text-lg text-muted">{t("lead")}</p>
          <a href={release.url} className="btn-primary mt-7 min-h-[58px] w-full max-w-sm px-8 text-[18px]" data-testid="android-download">
            <Download size={21} strokeWidth={2.6} aria-hidden /> {t("download")}
          </a>
          <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[15px] text-muted">
            <li data-testid="android-version">{t("versionLine", { version: release.versionName, date })}</li>
            {size && <li data-testid="android-size">{t("size", { size })}</li>}
          </ul>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-[15px] font-semibold text-fg" data-testid="android-requires">
            <Smartphone size={16} strokeWidth={2.4} className="shrink-0 text-hue-ink" aria-hidden /> {t("requires")}
          </p>
        </section>

        {/* How to install */}
        <section aria-labelledby="install-title" className="card mt-8 p-6 sm:p-8">
          <h2 id="install-title" className="text-xl font-black tracking-tight sm:text-[22px]">
            {t("installTitle")}
          </h2>
          <ol className="mt-5 space-y-4 text-[17px] leading-relaxed" data-testid="android-steps">
            {(["step1", "step2", "step3"] as const).map((key, i) => (
              <li key={key} className="flex gap-4">
                <span aria-hidden className="orb flex h-10 w-10 shrink-0 items-center justify-center font-display text-lg font-black" style={{ color: "var(--h-on)" }}>
                  <span className="relative z-10">{i + 1}</span>
                </span>
                <p className="pt-1.5">{key === "step2" ? t.rich("step2", { path }) : t(key)}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section aria-labelledby="no-store-title" className="card p-6">
            <h2 id="no-store-title" className="flex items-center gap-2 text-lg font-black tracking-tight">
              <Store size={20} strokeWidth={2.4} className="shrink-0 text-hue-ink" aria-hidden /> {t("noStoreTitle")}
            </h2>
            <p className="mt-2 text-muted">{t("noStoreBody")}</p>
          </section>
          <section aria-labelledby="iphone-title" className="card p-6" data-testid="android-iphone">
            <h2 id="iphone-title" className="text-lg font-black tracking-tight">
              {t("iphoneTitle")}
            </h2>
            <p className="mt-2 text-muted">{t("iphoneBody")}</p>
            <div className="mt-4 grid gap-2.5">
              <StoreButton href={APP_STORE_URL} label={tl("downloadIos")} soon={tl("comingSoon")} testId="android-download-ios" />
              <Link href="/register" className="btn-ghost hue-grape min-h-[50px] w-full">
                <Globe size={18} strokeWidth={2.4} aria-hidden /> {tl("downloadWeb")}
              </Link>
            </div>
          </section>
        </div>

        {/* Fingerprints, to check the file and its signature */}
        <section aria-labelledby="verify-title" className="card mt-6 p-6 sm:p-8">
          <h2 id="verify-title" className="flex items-center gap-2 text-xl font-black tracking-tight sm:text-[22px]">
            <ShieldCheck size={22} strokeWidth={2.4} className="shrink-0 text-hue-ink" aria-hidden /> {t("verifyTitle")}
          </h2>
          <p className="mt-2 text-muted">{t("verifyBody")}</p>
          <dl className="mt-5 space-y-5">
            <Fingerprint label={t("apkHash")} value={release.sha256} testId="android-apk-sha256" copy={t("copy")} copied={t("copied")} />
            <Fingerprint label={t("certHash")} value={release.certSha256} testId="android-cert-sha256" copy={t("copy")} copied={t("copied")} />
          </dl>
        </section>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-sm">
          <nav aria-label={tl("navPrivacy")} className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/privacy" className="font-semibold text-brand-ink hover:underline">
              {tg("privacy")}
            </Link>
            <Link href="/terms" className="font-semibold text-brand-ink hover:underline">
              {tg("terms")}
            </Link>
          </nav>
          <nav aria-label={tg("otherLanguages")} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            <span>{tg("otherLanguages")}:</span>
            {locales
              .filter((l) => l !== locale)
              .map((l) => (
                <a key={l} href={`?lang=${l}`} hrefLang={l} lang={l} className="font-semibold text-brand-ink hover:underline">
                  {localeNames[l]}
                </a>
              ))}
          </nav>
        </div>
      </main>
    </div>
  );
}

/** A SHA-256 in monospace that wraps anywhere, with a copy button. */
function Fingerprint({ label, value, testId, copy, copied }: { label: string; value: string; testId: string; copy: string; copied: string }) {
  const id = useId();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(timer);
  }, [done]);

  async function onCopy() {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    setDone(true);
  }

  return (
    <div>
      <dt id={id} className="font-display text-[15px] font-bold">
        {label}
      </dt>
      <dd className="mt-2 flex flex-col gap-3 rounded-field bg-field p-4 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 break-all font-mono text-[15px] leading-relaxed text-fg" data-testid={testId}>
          {value}
        </code>
        <button type="button" onClick={() => void onCopy()} aria-describedby={id} className="btn min-h-11 shrink-0 self-start bg-card px-4 text-fg shadow-soft ring-1 ring-line sm:self-center" data-testid={`${testId}-copy`}>
          {done ? <Check size={17} strokeWidth={2.6} aria-hidden /> : <Copy size={17} strokeWidth={2.4} aria-hidden />}
          {done ? copied : copy}
        </button>
        <span role="status" className="sr-only">
          {done ? copied : ""}
        </span>
      </dd>
    </div>
  );
}
