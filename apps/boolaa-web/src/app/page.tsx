import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  CodeXml,
  EyeOff,
  Globe,
  KeyRound,
  Link2,
  Lock,
  Megaphone,
  MessagesSquare,
  Plus,
  Shield,
  Smartphone,
  Sparkles,
  Tag,
  UsersRound,
  UtensilsCrossed,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { isLocale, type Locale } from "@/i18n/config";
import { CompactLocalePicker } from "@/i18n/locale-picker";
import { AmbientBackdrop, BubbleLogo, FeatureBadge, Orb } from "@/components/orb";
import { Phone, type Screen } from "@/components/phone";
import { hueClass, type Hue } from "@/lib/hue";
import { ANDROID_URL, APP_STORE_URL, REPO_URL, localizedUrls } from "@/lib/site";

// Signed-in users never get here: the proxy sends them to /home or /onboarding.

export async function generateMetadata({ searchParams }: PageProps<"/">): Promise<Metadata> {
  const [t, locale, { lang }] = await Promise.all([getTranslations("landing"), getLocale(), searchParams]);
  const title = t("metaTitle");
  const description = t("metaDescription");
  return { title: { absolute: title }, description, ...localizedUrls("/", { lang, locale, title, description }) };
}

type Feature = {
  key: "Chat" | "Events" | "Food" | "Market" | "Links" | "Bubbles";
  /** Name of the section in the app (`nav.*`); the bubbles panel has none. */
  nav?: "chat" | "events" | "food" | "marketplace" | "links";
  icon: LucideIcon;
  hue: Hue;
  screen: Screen;
  /** Wide panels put the copy beside the phone; the others stack it above. */
  wide?: "left" | "right";
};

// Each feature in its feature colour (docs/design-system.md 2.2), with the real screen.
const FEATURES: Feature[] = [
  { key: "Chat", nav: "chat", icon: MessagesSquare, hue: "grape", screen: "chat", wide: "right" },
  { key: "Events", nav: "events", icon: CalendarDays, hue: "coral", screen: "events" },
  { key: "Food", nav: "food", icon: UtensilsCrossed, hue: "tangerine", screen: "food" },
  { key: "Market", nav: "marketplace", icon: Tag, hue: "mint", screen: "market", wide: "left" },
  { key: "Links", nav: "links", icon: Link2, hue: "sky", screen: "links" },
  { key: "Bubbles", icon: UsersRound, hue: "pink", screen: "home" },
];

const STEPS = [
  { n: 1, hue: "grape", screen: "create", alt: "altCreate" },
  { n: 2, hue: "coral", screen: "settings", alt: "altInvite" },
  { n: 3, hue: "mint", screen: "pending", alt: "altPending" },
] as const;

const PROMISES = [
  { n: 1, icon: Lock },
  { n: 4, icon: Vote },
  { n: 2, icon: Megaphone },
  { n: 3, icon: EyeOff },
] as const;

const at = (i: number) => ({ "--i": i }) as CSSProperties;
const tilt = (deg: number, end = 0) => ({ "--tilt": `${deg}deg`, "--tilt-end": `${end}deg` }) as CSSProperties;

export default async function Landing() {
  const t = await getTranslations("landing");
  const tn = await getTranslations("nav");
  const tl = await getTranslations("legal");
  const current = await getLocale();
  const locale: Locale = isLocale(current) ? current : "en";
  const em = (chunks: ReactNode) => <em className="text-gradient not-italic">{chunks}</em>;
  const ghLink = (chunks: ReactNode) => (
    <a href={REPO_URL} className="font-semibold text-brand-ink underline underline-offset-2" rel="noopener">
      {chunks}
    </a>
  );

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
        {/* Hero: floating bubbles over the auth-screen gradient, and the app's Home screen */}
        <section className="relative isolate -mt-[68px] overflow-clip pt-[68px]">
          <AmbientBackdrop className="ambient-fade -z-10" />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 md:grid-cols-[1.1fr_1fr] md:pt-14 lg:gap-10">
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
              <p className="mt-1 flex items-start gap-1.5 text-sm text-muted">
                <Smartphone size={15} strokeWidth={2.4} className="mt-0.5 shrink-0" aria-hidden /> {t("heroApps")}
              </p>
            </div>
            <HeroPhones locale={locale} alt={t("altHome")} />
          </div>
        </section>

        {/* Features, each in its feature colour, shown with the real screen */}
        <section id="features" className="scroll-mt-24 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="reveal text-center text-3xl font-black tracking-tight sm:text-[40px]">{t("featuresTitle")}</h2>
            <p className="reveal mt-3 text-center text-lg text-muted">{t("featuresBody")}</p>
            <ul className="mt-12 grid gap-5 md:grid-cols-2">
              {FEATURES.map((f, i) => (
                <FeaturePanel
                  key={f.key}
                  feature={f}
                  index={i}
                  locale={locale}
                  label={f.nav ? tn(f.nav) : tn("yourBubbles")}
                  title={t(`feature${f.key}Title`)}
                  body={t(`feature${f.key}Body`)}
                  alt={f.key === "Bubbles" ? "" : t(`alt${f.key}`)}
                />
              ))}
            </ul>
          </div>
        </section>

        {/* How it works: the three real screens you go through */}
        <section id="how" className="scroll-mt-24 bg-landing-soft py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="reveal text-center text-3xl font-black tracking-tight sm:text-[40px]">{t("howTitle")}</h2>
            <ol className="mt-12 grid gap-5 md:grid-cols-3">
              {STEPS.map(({ n, hue, screen, alt }, i) => (
                <li key={n} className={`reveal card ${hueClass(hue)} relative flex flex-col overflow-clip`} style={at(i)}>
                  <div className="p-7 pb-6">
                    <span className="orb mb-5 flex h-14 w-14 items-center justify-center font-display text-2xl font-black" style={{ color: "var(--h-on)" }}>
                      <span className="relative z-10">{n}</span>
                    </span>
                    <h3 className="text-xl font-extrabold">{t(`step${n}Title`)}</h3>
                    <p className="mt-2 text-muted">{t(`step${n}Body`)}</p>
                  </div>
                  <div className="relative mt-auto h-[330px] overflow-clip bg-hue-wash">
                    <span aria-hidden className="absolute -left-10 top-10 h-28 w-28 rounded-full bg-hue-wash" />
                    <Phone locale={locale} screen={screen} alt={t(alt)} sizes="240px" className="tilt-in absolute left-1/2 top-8 !w-[240px] -translate-x-1/2" style={tilt(i === 1 ? 4 : -4)} />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Privacy promise: invite-only, and members vote newcomers in */}
        <section id="privacy" className="scroll-mt-24 px-5 py-16">
          <div className="hue-grape relative mx-auto max-w-6xl overflow-clip rounded-hero px-6 py-14 text-white shadow-glow sm:px-12" style={{ background: "linear-gradient(135deg, var(--grape) 0%, var(--grape-deep) 55%, var(--indigo-deep) 100%)" }}>
            <span aria-hidden className="absolute -right-16 -top-20 h-72 w-72 rounded-full bg-white/15" />
            <span aria-hidden className="absolute -bottom-24 left-10 h-56 w-56 rounded-full bg-white/[0.14]" />
            <span aria-hidden className="absolute right-24 top-16 h-16 w-16 rounded-full border-[3px] border-white/25" />
            <div className="relative grid items-center gap-12 lg:grid-cols-[1.25fr_1fr]">
              <div>
                <Shield size={34} strokeWidth={2.4} className="reveal mb-4" />
                <h2 className="reveal text-3xl font-black tracking-tight sm:text-[40px]">{t("privacyTitle")}</h2>
                <p className="reveal mt-2 text-lg text-white/90">{t("privacyBody")}</p>
                <ul className="mt-9 grid gap-4 sm:grid-cols-2">
                  {PROMISES.map(({ n, icon: Icon }, i) => (
                    <li key={n} className="reveal rounded-card bg-white/[0.13] p-5 ring-1 ring-white/20 backdrop-blur-sm" style={at(i)}>
                      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-[14px] bg-white/20">
                        <Icon size={22} strokeWidth={2.4} />
                      </span>
                      <h3 className="text-lg font-extrabold">{t(`promise${n}Title`)}</h3>
                      <p className="mt-1.5 text-white/90">{t(`promise${n}Body`)}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="relative mx-auto h-[560px] w-full max-w-[430px]">
                <Phone locale={locale} screen="join" alt={t("altJoin")} sizes="220px" className="tilt-in absolute right-0 top-0 !w-[220px] max-sm:hidden" style={tilt(12, 6)} />
                <Phone locale={locale} screen="requests" alt={t("altRequests")} sizes="250px" className="tilt-in absolute bottom-0 left-1/2 !w-[250px] max-sm:-translate-x-1/2 sm:left-0" style={tilt(-8, -3)} />
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 py-20">
          <div className="mx-auto max-w-3xl px-5">
            <h2 className="reveal text-center text-3xl font-black tracking-tight sm:text-[40px]">{t("faqTitle")}</h2>
            <div className="mt-10 space-y-3">
              {([1, 2, 3, 4, 5, 6, 7] as const).map((n, i) => (
                <details key={n} className="reveal group rounded-card bg-card p-5 shadow-soft" style={at(i)}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold [&::-webkit-details-marker]:hidden">
                    {t(`faq${n}Q`)}
                    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-ink transition-transform duration-300 [transition-timing-function:var(--ease-bouncy)] group-open:rotate-45">
                      <Plus size={18} strokeWidth={3} />
                    </span>
                  </summary>
                  <p className="mt-3 text-muted">{n === 7 ? t.rich("faq7A", { github: ghLink }) : t(`faq${n}A`)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final call to action and downloads */}
        <section id="download" className="scroll-mt-24 px-5 pb-24">
          <div className="reveal relative isolate mx-auto max-w-4xl overflow-clip rounded-hero px-6 py-16 text-center shadow-soft">
            <AmbientBackdrop className="-z-10" count={8} />
            <BubbleLogo size={64} className="mx-auto mb-4" />
            <h2 className="text-3xl font-black tracking-tight sm:text-[40px]">{t("finalTitle")}</h2>
            <p className="mt-2 text-lg text-muted">{t("finalBody")}</p>
            <ul className="mx-auto mt-8 grid max-w-md gap-3 sm:max-w-none sm:grid-cols-[auto_auto] sm:justify-center" data-testid="downloads">
              <li className="sm:col-span-2 sm:justify-self-center">
                <Link href="/register" className="btn-primary min-h-[54px] w-full px-8 text-[17px]" data-testid="download-web">
                  <Globe size={19} strokeWidth={2.4} aria-hidden /> {t("downloadWeb")}
                </Link>
              </li>
              <li>
                <StoreButton href={APP_STORE_URL} label={t("downloadIos")} soon={t("comingSoon")} testId="download-ios" />
              </li>
              <li>
                <StoreButton href={ANDROID_URL} label={t("downloadAndroid")} soon={t("comingSoon")} testId="download-android" />
              </li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Logo />
            <p className="mt-2 text-sm text-muted">{t("footerTagline")}</p>
            <p className="mt-1 text-sm text-muted" data-testid="made-by">{t("footerMadeBy")}</p>
            <p className="mt-1 text-xs text-muted">{t("copyright", { year: new Date().getFullYear() })}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm font-semibold" aria-label={t("navPrivacy")}>
            <Link href="/privacy" className="hover:text-brand-ink">
              {tl("privacy")}
            </Link>
            <Link href="/terms" className="hover:text-brand-ink">
              {tl("terms")}
            </Link>
            <a href={REPO_URL} className="inline-flex items-center gap-1.5 hover:text-brand-ink" rel="noopener" data-testid="source-code">
              <CodeXml size={16} strokeWidth={2.4} aria-hidden /> {t("sourceCode")}
            </a>
            <CompactLocalePicker up />
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
          <a href="#features" className="hover:text-fg">
            {labels.features}
          </a>
          <a href="#how" className="hover:text-fg">
            {labels.how}
          </a>
          <a href="#privacy" className="hover:text-fg">
            {labels.privacy}
          </a>
          <a href="#faq" className="hover:text-fg">
            {labels.faq}
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <CompactLocalePicker />
          <Link href="/login" className="press hidden rounded-full px-4 py-2 font-display text-[15px] font-bold text-brand-ink hover:bg-brand/10 sm:inline-flex" data-testid="landing-sign-in">
            {labels.signIn}
          </Link>
          <Link href="/register" className="btn-primary min-h-10 whitespace-nowrap px-4 py-2 text-sm">
            {labels.start}
          </Link>
        </div>
      </div>
    </header>
  );
}

/** The app's Home screen up front, the chat peeking out behind it, and the feature badges floating around. */
function HeroPhones({ locale, alt }: { locale: Locale; alt: string }) {
  return (
    <div className="relative mx-auto w-full max-w-[400px] pb-2 lg:max-w-[440px]">
      <Phone locale={locale} screen="chat" alt="" sizes="250px" className="absolute right-0 top-12 !w-[56%] rotate-[7deg] max-sm:hidden" />
      <div className="float-slow relative w-[72%] max-sm:mx-auto sm:w-[66%]">
        <Phone locale={locale} screen="home" alt={alt} eager sizes="(min-width: 640px) 290px, 280px" className="-rotate-2" />
      </div>
      <span className="float-slower absolute -left-6 top-24 max-sm:left-0">
        <FeatureBadge hue="coral" size={54}><CalendarDays size={26} strokeWidth={2.4} /></FeatureBadge>
      </span>
      <span className="float-slow absolute -top-3 left-[63%] [animation-delay:-2s] max-sm:-top-5 max-sm:left-auto max-sm:right-2">
        <FeatureBadge hue="tangerine" size={50}><UtensilsCrossed size={24} strokeWidth={2.4} /></FeatureBadge>
      </span>
      <span className="float-slower absolute bottom-24 right-0 [animation-delay:-4s]">
        <FeatureBadge hue="mint" size={46}><Tag size={22} strokeWidth={2.4} /></FeatureBadge>
      </span>
      <span className="float-slow absolute -left-3 bottom-10 [animation-delay:-1s] max-sm:left-2">
        <Orb hue="sunny" size={30} />
      </span>
    </div>
  );
}

/** One feature: a tinted panel in the feature colour with the real screen rising out of its bottom edge. */
function FeaturePanel({ feature, index, locale, label, title, body, alt }: { feature: Feature; index: number; locale: Locale; label: string; title: string; body: string; alt: string }) {
  const { icon: Icon, hue, screen, wide } = feature;
  return (
    <li
      data-hue={hue}
      className={`reveal group relative isolate flex flex-col overflow-clip rounded-hero bg-hue-wash ${hueClass(hue)} ${wide ? "md:col-span-2 md:grid md:grid-cols-2 md:items-center" : ""}`}
      style={at(index % 2)}
    >
      <span aria-hidden className="absolute -right-16 -top-16 -z-10 h-56 w-56 rounded-full bg-hue-wash" />
      <span aria-hidden className="absolute -left-10 bottom-10 -z-10 h-32 w-32 rounded-full bg-hue-wash" />
      <div className={`p-7 pb-2 sm:p-10 sm:pb-4 ${wide ? "md:p-14" : ""} ${wide === "left" ? "md:order-2" : ""}`}>
        <div className="mb-5 flex items-center gap-3">
          <FeatureBadge hue={hue} size={48} className="transition-transform duration-300 [transition-timing-function:var(--ease-bouncy)] group-hover:-rotate-6 group-hover:scale-110">
            <Icon size={24} strokeWidth={2.4} />
          </FeatureBadge>
          <span className="font-display text-sm font-extrabold uppercase tracking-wider text-hue-ink">{label}</span>
        </div>
        <h3 className={`text-balance text-2xl font-black tracking-tight sm:text-3xl ${wide ? "md:text-[40px] md:leading-[1.08]" : ""}`}>{title}</h3>
        <p className={`mt-3 max-w-md text-pretty text-fg/75 ${wide ? "text-lg" : "text-[17px]"}`}>{body}</p>
      </div>
      <div className={`relative mt-auto h-[400px] ${wide ? "md:mt-0 md:h-[520px]" : "md:h-[470px]"}`}>
        <Phone
          locale={locale}
          screen={screen}
          alt={alt}
          className={`tilt-in absolute left-1/2 top-9 !w-[270px] -translate-x-1/2 ${wide ? "md:top-12 md:!w-[300px]" : ""}`}
          style={tilt(index % 2 ? 5 : -5)}
        />
      </div>
    </li>
  );
}

/** A download button. Without a link yet it is plain, dimmed text with a "Coming soon" badge. */
function StoreButton({ href, label, soon, testId }: { href: string | null; label: string; soon: string; testId: string }) {
  const shape = "flex min-h-[54px] w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-[27px] px-6 py-2.5 font-display text-[16px] font-bold";
  if (href)
    return (
      <Link href={href} className={`press ${shape} bg-card text-fg shadow-soft ring-1 ring-line`} data-testid={testId}>
        <Smartphone size={18} strokeWidth={2.4} aria-hidden /> {label}
      </Link>
    );
  return (
    <span className={`${shape} bg-card/70 text-muted ring-1 ring-line backdrop-blur`} data-testid={testId}>
      <span className="inline-flex items-center gap-2">
        <Smartphone size={18} strokeWidth={2.4} className="shrink-0" aria-hidden /> {label}
      </span>
      <span className="hue-grape whitespace-nowrap rounded-full bg-hue-wash px-2.5 py-0.5 text-xs font-extrabold text-hue-ink">{soon}</span>
    </span>
  );
}
