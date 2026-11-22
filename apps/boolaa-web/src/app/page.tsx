import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  ArrowUp,
  CalendarDays,
  EyeOff,
  KeyRound,
  Link2,
  Lock,
  Megaphone,
  MessagesSquare,
  Plus,
  Shield,
  Sparkles,
  Tag,
  UtensilsCrossed,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { CompactLocalePicker } from "@/i18n/locale-picker";
import { locales } from "@/i18n/config";
import { AmbientBackdrop, BubbleLogo, FeatureBadge, Orb } from "@/components/orb";
import { hueClass, type Hue } from "@/lib/hue";
import { pageUrls } from "@/lib/site";

// Signed-in users never get here: the proxy sends them to /home or /onboarding.

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("landing"), getLocale()]);
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title: { absolute: title },
    description,
    alternates: pageUrls("/").alternates,
    openGraph: {
      ...pageUrls("/").openGraph,
      title,
      description,
      locale,
      alternateLocale: locales.filter((l) => l !== locale),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

const FEATURES = [
  { key: "Chat", nav: "chat", icon: MessagesSquare, hue: "grape" },
  { key: "Events", nav: "events", icon: CalendarDays, hue: "coral" },
  { key: "Food", nav: "food", icon: UtensilsCrossed, hue: "tangerine" },
  { key: "Market", nav: "marketplace", icon: Tag, hue: "mint" },
  { key: "Links", nav: "links", icon: Link2, hue: "sky" },
] as const;

const STEPS = [
  { n: 1, hue: "grape" },
  { n: 2, hue: "coral" },
  { n: 3, hue: "mint" },
] as const;

const PROMISES = [
  { n: 1, icon: Lock },
  { n: 2, icon: Megaphone },
  { n: 3, icon: EyeOff },
] as const;

const at = (i: number) => ({ "--i": i }) as CSSProperties;

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
        {/* Hero: floating bubbles over the auth-screen gradient */}
        <section className="relative isolate -mt-[68px] overflow-hidden pt-[68px]">
          <AmbientBackdrop className="ambient-fade -z-10" />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-24 pt-10 md:grid-cols-[1.1fr_1fr] md:pt-16 lg:gap-16">
            <div className="relative">
              <BubbleLogo size={72} className="mb-5" />
              <p className="mb-5 flex w-fit items-center gap-2 rounded-full bg-card/70 px-4 py-1.5 font-display text-sm font-bold text-brand-ink shadow-soft backdrop-blur">
                <Sparkles size={15} /> {t("eyebrow")}
              </p>
              <h1 className="text-balance text-[2.7rem] font-black leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
                {t.rich("heroTitle", { em })}
              </h1>
              <p className="mt-6 max-w-xl text-pretty text-lg text-muted sm:text-xl">{t("heroBody")}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/register" className="btn-primary min-h-[54px] px-7 text-[17px]" data-testid="cta-register">
                  {t("ctaPrimary")} <ArrowRight size={19} strokeWidth={2.6} />
                </Link>
                <Link href="/register" className="btn-ghost min-h-[54px] bg-card/70 px-6 text-[17px] backdrop-blur">
                  <KeyRound size={18} strokeWidth={2.4} /> {t("ctaSecondary")}
                </Link>
              </div>
              <p className="mt-4 text-sm text-muted">{t("heroNote")}</p>
            </div>
            <PhoneMockup lines={[t("mockChat1"), t("mockChat2"), t("mockChat3")]} title={tn("chat")} />
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-24 py-20">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="reveal text-center text-3xl font-black tracking-tight sm:text-[40px]">{t("howTitle")}</h2>
            <ol className="mt-12 grid gap-5 md:grid-cols-3">
              {STEPS.map(({ n, hue }, i) => (
                <li key={n} className={`reveal lift card ${hueClass(hue)} relative p-7`} style={at(i)}>
                  <span className="orb mb-5 flex h-14 w-14 items-center justify-center font-display text-2xl font-black" style={{ color: "var(--h-on)" }}>
                    <span className="relative z-10">{n}</span>
                  </span>
                  <h3 className="text-xl font-extrabold">{t(`step${n}Title`)}</h3>
                  <p className="mt-2 text-muted">{t(`step${n}Body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features, each in its feature colour */}
        <section id="features" className="scroll-mt-24 bg-landing-soft py-20">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="reveal text-center text-3xl font-black tracking-tight sm:text-[40px]">{t("featuresTitle")}</h2>
            <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ key, nav, icon: Icon, hue }, i) => (
                <li
                  key={key}
                  data-hue={hue}
                  className={`reveal lift group relative overflow-hidden rounded-card bg-card p-6 shadow-soft ${hueClass(hue)} ${i === 0 ? "lg:row-span-2" : ""}`}
                  style={at(i)}
                >
                  <span aria-hidden className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-hue-wash transition-transform duration-500 group-hover:scale-125" />
                  <FeatureBadge hue={hue} size={52} className="relative mb-4 transition-transform duration-300 [transition-timing-function:var(--ease-bouncy)] group-hover:-rotate-6 group-hover:scale-110">
                    <Icon size={26} strokeWidth={2.4} />
                  </FeatureBadge>
                  <h3 className="relative text-xl font-extrabold text-hue-ink">{tn(nav)}</h3>
                  <p className="relative mt-1.5 text-muted">{t(`feature${key}Body`)}</p>
                  {i === 0 && <ChatDoodle />}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Privacy promise */}
        <section id="privacy" className="scroll-mt-24 px-5 py-16">
          <div className="hue-grape relative mx-auto max-w-6xl overflow-hidden rounded-hero px-6 py-14 text-white shadow-glow sm:px-12" style={{ background: "linear-gradient(135deg, var(--grape) 0%, var(--grape-deep) 55%, var(--indigo-deep) 100%)" }}>
            <span aria-hidden className="absolute -right-16 -top-20 h-72 w-72 rounded-full bg-white/15" />
            <span aria-hidden className="absolute -bottom-24 left-10 h-56 w-56 rounded-full bg-white/[0.14]" />
            <span aria-hidden className="absolute right-24 top-16 h-16 w-16 rounded-full border-[3px] border-white/25" />
            <div className="relative">
              <Shield size={34} strokeWidth={2.4} className="reveal mb-4" />
              <h2 className="reveal text-3xl font-black tracking-tight sm:text-[40px]">{t("privacyTitle")}</h2>
              <p className="reveal mt-2 text-lg text-white/90">{t("privacyBody")}</p>
              <ul className="mt-10 grid gap-5 md:grid-cols-3">
                {PROMISES.map(({ n, icon: Icon }, i) => (
                  <li key={n} className="reveal rounded-card bg-white/[0.13] p-6 ring-1 ring-white/20 backdrop-blur-sm" style={at(i)}>
                    <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-[14px] bg-white/20">
                      <Icon size={22} strokeWidth={2.4} />
                    </span>
                    <h3 className="text-lg font-extrabold">{t(`promise${n}Title`)}</h3>
                    <p className="mt-1.5 text-white/90">{t(`promise${n}Body`)}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 py-20">
          <div className="mx-auto max-w-3xl px-5">
            <h2 className="reveal text-center text-3xl font-black tracking-tight sm:text-[40px]">{t("faqTitle")}</h2>
            <div className="mt-10 space-y-3">
              {([1, 2, 3, 4, 5, 6] as const).map((n, i) => (
                <details key={n} className="reveal group rounded-card bg-card p-5 shadow-soft" style={at(i)}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold [&::-webkit-details-marker]:hidden">
                    {t(`faq${n}Q`)}
                    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-ink transition-transform duration-300 [transition-timing-function:var(--ease-bouncy)] group-open:rotate-45">
                      <Plus size={18} strokeWidth={3} />
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
          <div className="reveal relative isolate mx-auto max-w-4xl overflow-hidden rounded-hero px-6 py-16 text-center shadow-soft">
            <AmbientBackdrop className="-z-10" count={8} />
            <BubbleLogo size={64} className="mx-auto mb-4" />
            <h2 className="text-3xl font-black tracking-tight sm:text-[40px]">{t("finalTitle")}</h2>
            <p className="mt-2 text-lg text-muted">{t("finalBody")}</p>
            <Link href="/register" className="btn-primary mt-8 min-h-[54px] px-7 text-[17px]">
              {t("ctaPrimary")} <ArrowRight size={19} strokeWidth={2.6} />
            </Link>
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
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm font-semibold" aria-label={t("navPrivacy")}>
            <Link href="/privacy" className="hover:text-brand-ink">
              {tl("privacy")}
            </Link>
            <Link href="/terms" className="hover:text-brand-ink">
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
      <BubbleLogo size={32} animated={false} />
      <span className="font-display text-[26px] font-black tracking-tight">Boolaa</span>
    </span>
  );
}

function Header({ labels }: { labels: Record<"how" | "features" | "privacy" | "faq" | "signIn" | "start", string> }) {
  return (
    <header className="sticky top-0 z-50 h-[68px] bg-[color-mix(in_srgb,var(--app-bg)_72%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-full max-w-6xl items-center gap-4 px-5">
        <Link href="/" aria-label="Boolaa">
          <Logo />
        </Link>
        <nav className="ml-6 hidden items-center gap-6 font-display text-[15px] font-bold text-muted md:flex">
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
          <Link href="/login" className="press hidden rounded-full px-4 py-2 font-display text-[15px] font-bold text-brand-ink hover:bg-brand/10 sm:inline-flex" data-testid="landing-sign-in">
            {labels.signIn}
          </Link>
          <Link href="/register" className="btn-primary min-h-10 px-4 py-2 text-sm">
            {labels.start}
          </Link>
        </div>
      </div>
    </header>
  );
}

/**
 * Phone mock-up drawn in CSS: the chat screen of the app. The device frame is dark in both
 * colour schemes; the screen follows the scheme.
 */
function PhoneMockup({ lines, title }: { lines: string[]; title: string }) {
  return (
    <div className="relative mx-auto w-full max-w-[340px]" aria-hidden>
      <div className="float-slow relative rounded-[48px] bg-[#1e1638] p-[10px] shadow-[0_40px_80px_-30px_rgb(42_27_94/0.55)] ring-1 ring-white/10 dark:bg-[#0b0814] dark:shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9)] dark:ring-white/15">
        <div className="relative overflow-hidden rounded-[38px] bg-app">
          <div className="hue-sky pointer-events-none absolute inset-0" style={{ background: "radial-gradient(240px 220px at 100% 0%, color-mix(in srgb, var(--h) var(--glow-a), transparent), transparent)" }} />
          <div className="relative px-4 pb-4 pt-3">
            <div className="mx-auto mb-4 h-6 w-24 rounded-full bg-[#1e1638] dark:bg-[#0b0814]" />
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-[26px] font-black">{title}</span>
              <span className="hue-sunny flex h-8 w-8 items-center justify-center rounded-full bg-hue-grad font-display text-xs font-black text-onfill">A</span>
            </div>
            <div className="mb-5 flex gap-1.5">
              {([["Flat 4B", "sky"], ["Climbing", "tangerine"], ["Book club", "pink"]] as const).map(([b, hue], i) => (
                <span key={b} className={`${hueClass(hue)} inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-display text-[11px] font-bold ${i === 0 ? "fill-hue" : "bg-card shadow-soft"}`}>
                  <span className={`orb h-2.5 w-2.5 ${i === 0 ? "ring-1 ring-white" : ""}`} />
                  {b}
                </span>
              ))}
            </div>
            <div className="space-y-3">
              <MockMessage who="M" hue="coral" name="Mara">{lines[0]}</MockMessage>
              <MockMessage mine>{lines[1]}</MockMessage>
              <MockMessage who="S" hue="mint" name="Sam">{lines[2]}</MockMessage>
            </div>
            <div className="mt-5 flex items-center gap-2">
              <span className="flex h-10 flex-1 items-center rounded-full bg-card px-4 text-xs text-muted shadow-soft">…</span>
              <span className="hue-grape fill-hue flex h-10 w-10 items-center justify-center rounded-full">
                <ArrowUp size={18} strokeWidth={3} />
              </span>
            </div>
          </div>
        </div>
      </div>
      <span className="float-slower absolute -left-7 top-28">
        <FeatureBadge hue="coral" size={54}><CalendarDays size={26} strokeWidth={2.4} /></FeatureBadge>
      </span>
      <span className="float-slow absolute -right-5 -top-5 [animation-delay:-2s]">
        <FeatureBadge hue="tangerine" size={50}><UtensilsCrossed size={24} strokeWidth={2.4} /></FeatureBadge>
      </span>
      <span className="float-slower absolute -right-3 bottom-20 [animation-delay:-4s]">
        <FeatureBadge hue="mint" size={46}><Tag size={22} strokeWidth={2.4} /></FeatureBadge>
      </span>
      <span className="float-slow absolute -left-3 bottom-10 [animation-delay:-1s]">
        <Orb hue="sunny" size={30} />
      </span>
    </div>
  );
}

function MockMessage({ who, hue, name, mine, children }: { who?: string; hue?: Hue; name?: string; mine?: boolean; children: ReactNode }) {
  if (mine)
    return (
      <div className="flex justify-end">
        <span className="hue-grape max-w-[78%] rounded-[18px] rounded-br-[6px] bg-hue-grad px-3 py-2 text-[13px] leading-snug text-white shadow-glow">{children}</span>
      </div>
    );
  return (
    <div className={`flex items-end gap-2 ${hue ? hueClass(hue) : ""}`}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-hue-grad font-display text-[11px] font-black text-onfill ring-[1.5px] ring-card">{who}</span>
      <span className="max-w-[78%]">
        <span className="mb-0.5 block font-display text-[11px] font-extrabold text-hue-ink">{name}</span>
        <span className="block rounded-[18px] rounded-bl-[6px] bg-card px-3 py-2 text-[13px] leading-snug shadow-soft">{children}</span>
      </span>
    </div>
  );
}

/** Speech bubbles doodle for the big chat card. */
function ChatDoodle() {
  return (
    <svg viewBox="0 0 220 120" className="relative mt-6 hidden w-full lg:block" aria-hidden>
      <defs>
        <linearGradient id="doodle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--grape)" />
          <stop offset="1" stopColor="var(--grape-deep)" />
        </linearGradient>
      </defs>
      <rect x="8" y="10" width="130" height="44" rx="22" fill="url(#doodle)" />
      <path d="M30 54 l-8 14 l20 -14z" fill="url(#doodle)" />
      <rect x="82" y="62" width="130" height="44" rx="22" fill="var(--app-field)" />
      <circle cx="122" cy="84" r="5" fill="var(--grape)" />
      <circle cx="147" cy="84" r="5" fill="var(--grape)" opacity="0.7" />
      <circle cx="172" cy="84" r="5" fill="var(--grape)" opacity="0.4" />
    </svg>
  );
}
