import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  EyeOff,
  KeyRound,
  Link2,
  Lock,
  MessageCircle,
  Megaphone,
  Sparkles,
  Tags,
  UsersRound,
  UtensilsCrossed,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { CompactLocalePicker } from "@/i18n/locale-picker";
import { locales } from "@/i18n/config";

// Signed-in users never get here: the proxy sends them to /home or /onboarding.

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("landing"), getLocale()]);
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: "/",
      siteName: "Boolaa",
      title,
      description,
      locale,
      alternateLocale: locales.filter((l) => l !== locale),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

const FEATURES = [
  { key: "Chat", nav: "chat", icon: MessageCircle },
  { key: "Events", nav: "events", icon: CalendarDays },
  { key: "Food", nav: "food", icon: UtensilsCrossed },
  { key: "Market", nav: "marketplace", icon: Tags },
  { key: "Links", nav: "links", icon: Link2 },
] as const;

const PROMISES = [
  { n: 1, icon: Lock },
  { n: 2, icon: Megaphone },
  { n: 3, icon: EyeOff },
] as const;

export default async function Landing() {
  const t = await getTranslations("landing");
  const tn = await getTranslations("nav");
  const tl = await getTranslations("legal");
  const em = (chunks: ReactNode) => <em className="text-gradient not-italic">{chunks}</em>;

  return (
    <div className="relative overflow-x-clip" data-testid="landing">
      <Header
        labels={{
          how: t("navHow"),
          features: t("navFeatures"),
          privacy: t("navPrivacy"),
          faq: t("navFaq"),
          signIn: t("signIn"),
          start: t("getStarted"),
        }}
      />

      <main>
        {/* Hero */}
        <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 md:grid-cols-[1.1fr_1fr] md:pt-16 lg:gap-16">
          <span aria-hidden className="blob -left-24 -top-10 h-80 w-80 bg-[var(--landing-blob-1)]" />
          <span aria-hidden className="blob right-0 top-40 h-72 w-72 bg-[var(--landing-blob-2)] [animation-delay:-6s]" />
          <div className="relative">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-landing-soft px-4 py-1.5 text-sm font-semibold text-brand">
              <Sparkles size={15} /> {t("eyebrow")}
            </p>
            <h1 className="text-balance text-[2.6rem] font-black leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              {t.rich("heroTitle", { em })}
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg text-muted sm:text-xl">{t("heroBody")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn bg-gradient-brand px-6 py-3 text-base text-white shadow-landing hover:opacity-95" data-testid="cta-register">
                {t("ctaPrimary")} <ArrowRight size={18} />
              </Link>
              <Link href="/register" className="btn-ghost px-6 py-3 text-base">
                <KeyRound size={18} /> {t("ctaSecondary")}
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted">{t("heroNote")}</p>
          </div>
          <HeroIllustration lines={[t("mockChat1"), t("mockChat2"), t("mockChat3")]} tabs={[tn("chat"), tn("events"), tn("food")]} />
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-24 bg-landing-soft py-20">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="reveal text-center text-3xl font-black tracking-tight sm:text-4xl">{t("howTitle")}</h2>
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {[1, 2, 3].map((n) => (
                <li key={n} className="reveal lift relative rounded-landing bg-landing-surface p-7 shadow-soft">
                  <span className="bg-gradient-brand mb-5 flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-black text-white">
                    {n}
                  </span>
                  <h3 className="text-xl font-bold">{t(`step${n as 1 | 2 | 3}Title`)}</h3>
                  <p className="mt-2 text-muted">{t(`step${n as 1 | 2 | 3}Body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-24 py-20">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="reveal text-center text-3xl font-black tracking-tight sm:text-4xl">{t("featuresTitle")}</h2>
            <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ key, nav, icon: Icon }, i) => (
                <li
                  key={key}
                  className={`reveal lift group rounded-landing border border-line bg-landing-surface p-6 ${i === 0 ? "lg:row-span-2" : ""}`}
                >
                  <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-landing-soft text-brand transition group-hover:rotate-[-6deg] group-hover:scale-110">
                    <Icon size={24} />
                  </span>
                  <h3 className="text-lg font-bold">{tn(nav)}</h3>
                  <p className="mt-1.5 text-muted">{t(`feature${key}Body`)}</p>
                  {i === 0 && <ChatDoodle />}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Privacy promise */}
        <section id="privacy" className="scroll-mt-24 px-5 py-10">
          <div className="bg-gradient-brand relative mx-auto max-w-6xl overflow-hidden rounded-[calc(var(--landing-radius)*1.4)] px-6 py-14 text-white sm:px-12">
            <span aria-hidden className="blob -right-16 -top-16 h-64 w-64 bg-white/20" />
            <span aria-hidden className="blob -bottom-24 left-10 h-64 w-64 bg-[var(--landing-blob-3)]" />
            <div className="relative">
              <h2 className="reveal text-3xl font-black tracking-tight sm:text-4xl">{t("privacyTitle")}</h2>
              <p className="reveal mt-2 text-lg text-white/85">{t("privacyBody")}</p>
              <ul className="mt-10 grid gap-5 md:grid-cols-3">
                {PROMISES.map(({ n, icon: Icon }) => (
                  <li key={n} className="reveal rounded-landing bg-white/12 p-6 backdrop-blur-sm">
                    <Icon size={26} className="mb-3" />
                    <h3 className="text-lg font-bold">{t(`promise${n}Title`)}</h3>
                    <p className="mt-1.5 text-white/85">{t(`promise${n}Body`)}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 py-20">
          <div className="mx-auto max-w-3xl px-5">
            <h2 className="reveal text-center text-3xl font-black tracking-tight sm:text-4xl">{t("faqTitle")}</h2>
            <div className="mt-10 space-y-3">
              {([1, 2, 3, 4, 5, 6] as const).map((n) => (
                <details key={n} className="reveal group rounded-2xl border border-line bg-landing-surface p-5 open:shadow-soft">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                    {t(`faq${n}Q`)}
                    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-landing-soft text-brand transition group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-muted">{t(`faq${n}A`)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final call to action */}
        <section className="px-5 pb-24">
          <div className="reveal relative mx-auto max-w-4xl overflow-hidden rounded-[calc(var(--landing-radius)*1.4)] bg-landing-soft px-6 py-16 text-center">
            <span aria-hidden className="blob -left-10 -top-10 h-48 w-48 bg-[var(--landing-blob-2)]" />
            <span aria-hidden className="blob -bottom-12 -right-6 h-56 w-56 bg-[var(--landing-blob-3)]" />
            <div className="relative">
              <UsersRound size={40} className="mx-auto mb-4 text-brand" />
              <h2 className="text-3xl font-black tracking-tight sm:text-4xl">{t("finalTitle")}</h2>
              <p className="mt-2 text-lg text-muted">{t("finalBody")}</p>
              <Link href="/register" className="btn bg-gradient-brand mt-8 px-7 py-3 text-base text-white shadow-landing hover:opacity-95">
                {t("ctaPrimary")} <ArrowRight size={18} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Logo />
            <p className="mt-2 text-sm text-muted">{t("footerTagline")}</p>
            <p className="mt-1 text-xs text-muted">{t("copyright", { year: new Date().getFullYear() })}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm font-medium" aria-label={t("navPrivacy")}>
            <Link href="/privacy" className="hover:text-brand">
              {tl("privacy")}
            </Link>
            <Link href="/terms" className="hover:text-brand">
              {tl("terms")}
            </Link>
            <CompactLocalePicker />
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="bg-gradient-brand flex h-9 w-9 items-center justify-center rounded-full text-lg font-black text-white">b</span>
      <span className="text-2xl font-black tracking-tight text-brand">boolaa</span>
    </span>
  );
}

function Header({ labels }: { labels: Record<"how" | "features" | "privacy" | "faq" | "signIn" | "start", string> }) {
  return (
    <header className="sticky top-0 z-50 border-b border-transparent bg-[color-mix(in_oklab,var(--app-bg)_80%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
        <Link href="/" aria-label="Boolaa">
          <Logo />
        </Link>
        <nav className="ml-6 hidden items-center gap-6 text-sm font-medium text-muted md:flex">
          <a href="#how" className="hover:text-fg">
            {labels.how}
          </a>
          <a href="#features" className="hover:text-fg">
            {labels.features}
          </a>
          <a href="#privacy" className="hover:text-fg">
            {labels.privacy}
          </a>
          <a href="#faq" className="hover:text-fg">
            {labels.faq}
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/login" className="hidden rounded-full px-4 py-2 text-sm font-semibold text-brand hover:bg-chip sm:inline-flex" data-testid="landing-sign-in">
            {labels.signIn}
          </Link>
          <Link href="/register" className="btn-primary px-4 py-2 text-sm">
            {labels.start}
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Phone mock-up drawn with CSS: a chat preview with floating stickers. */
function HeroIllustration({ lines, tabs }: { lines: [string, string, string] | string[]; tabs: string[] }) {
  return (
    <div className="relative mx-auto w-full max-w-sm" aria-hidden>
      <span className="blob left-6 top-10 h-64 w-64 bg-[var(--landing-blob-3)] [animation-delay:-3s]" />
      <div className="float-slow relative rounded-[44px] border-[10px] border-[color-mix(in_oklab,var(--app-fg)_88%,transparent)] bg-app p-4 shadow-landing">
        <div className="mx-auto mb-4 h-5 w-24 rounded-full bg-[color-mix(in_oklab,var(--app-fg)_88%,transparent)]" />
        <div className="mb-4 flex gap-2">
          {["Flat 4B", "Climbing", "Book club"].map((b, i) => (
            <span key={b} className={`rounded-full px-3 py-1 text-xs font-semibold ${i === 0 ? "bg-brand text-white" : "bg-chip text-brand"}`}>
              {b}
            </span>
          ))}
        </div>
        <div className="space-y-3">
          <Bubble who="M" tone="other">
            {lines[0]}
          </Bubble>
          <Bubble who="A" tone="mine">
            {lines[1]}
          </Bubble>
          <Bubble who="S" tone="other">
            {lines[2]}
          </Bubble>
        </div>
        <div className="mt-5 flex justify-around rounded-full bg-landing-surface px-3 py-2 shadow-soft">
          {tabs.map((tab, i) => (
            <span key={tab} className={`rounded-full px-3 py-1 text-[11px] font-semibold ${i === 0 ? "bg-brand text-white" : "text-muted"}`}>
              {tab}
            </span>
          ))}
        </div>
      </div>
      <span className="float-slower absolute -left-6 top-24 rounded-2xl bg-landing-surface px-3 py-2 text-2xl shadow-landing">🍲</span>
      <span className="float-slow absolute -right-4 top-6 rounded-2xl bg-landing-surface px-3 py-2 text-2xl shadow-landing">🎉</span>
      <span className="float-slower absolute -right-2 bottom-16 rounded-2xl bg-landing-surface px-3 py-2 text-2xl shadow-landing">🪴</span>
    </div>
  );
}

function Bubble({ who, tone, children }: { who: string; tone: "mine" | "other"; children: ReactNode }) {
  const mine = tone === "mine";
  return (
    <div className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand bg-chip text-[11px] font-bold text-brand">
        {who}
      </span>
      <span
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-brand/15"}`}
      >
        {children}
      </span>
    </div>
  );
}

/** Little SVG doodle of overlapping speech bubbles for the big chat card. */
function ChatDoodle() {
  return (
    <svg viewBox="0 0 220 120" className="mt-6 hidden w-full lg:block" aria-hidden>
      <defs>
        <linearGradient id="doodle" x1="0" x2="1">
          <stop offset="0" stopColor="var(--landing-grad-from)" />
          <stop offset="1" stopColor="var(--landing-grad-to)" />
        </linearGradient>
      </defs>
      <rect x="8" y="10" width="130" height="44" rx="22" fill="url(#doodle)" opacity="0.9" />
      <path d="M30 54 l-8 14 l20 -14z" fill="url(#doodle)" opacity="0.9" />
      <rect x="82" y="62" width="130" height="44" rx="22" fill="var(--landing-soft)" stroke="var(--color-brand)" strokeWidth="2" />
      <circle cx="122" cy="84" r="5" fill="var(--color-brand)" />
      <circle cx="147" cy="84" r="5" fill="var(--color-brand)" opacity="0.7" />
      <circle cx="172" cy="84" r="5" fill="var(--color-brand)" opacity="0.4" />
    </svg>
  );
}
