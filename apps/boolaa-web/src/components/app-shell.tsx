"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronLeft,
  Home,
  Link2,
  MessagesSquare,
  Plus,
  Settings,
  Tags,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useBoolaa } from "@/components/boolaa-provider";
import { useChatUnread } from "@/components/chat-unread";
import { badgeText } from "@/lib/chat";
import { CreateJoinTabs } from "@/components/create-join";
import { ProfileSheet } from "@/components/profile-sheet";
import { DeepLinkTarget } from "@/components/deep-link";
import { BubbleSearch, SearchButton } from "@/components/bubble-search";
import { BubbleLogo } from "@/components/orb";
import { Avatar, Modal } from "@/components/ui";
import { FEATURE_HUE, hueClass, hueFor } from "@/lib/hue";
import { BAND_HUE } from "@/lib/brand";
import { CheerHost } from "@/components/cheer";
import { cx } from "@/lib/utils";
import { useSignedUrl } from "@/lib/storage-url";
import { scrollBehavior } from "@/lib/a11y";
import { ConnectivityBanner } from "@/components/offline";

type NavKey = "home" | "events" | "food" | "marketplace" | "settings" | "chat" | "links";
type NavItem = { href: string; key: NavKey; icon: LucideIcon };

export const TABS: NavItem[] = [
  { href: "/home", key: "home", icon: Home },
  { href: "/events", key: "events", icon: CalendarDays },
  { href: "/food", key: "food", icon: UtensilsCrossed },
  { href: "/marketplace", key: "marketplace", icon: Tags },
  { href: "/settings", key: "settings", icon: Settings },
];
const EXTRA: NavItem[] = [
  { href: "/chat", key: "chat", icon: MessagesSquare },
  { href: "/links", key: "links", icon: Link2 },
];

function navKeyFor(pathname: string): NavKey | null {
  return [...TABS, ...EXTRA].find((t) => pathname.startsWith(t.href))?.key ?? null;
}

/**
 * Unread chat count bubble (docs/boolaa-spec.md, "Chat"): the number up to 99, then "99+". Hidden from
 * assistive tech: the control carries the count as its description (useUnreadDescription), so its
 * accessible name stays the bubble / section name.
 */
function UnreadBadge({ count, className }: { count: number | undefined; className?: string }) {
  const text = badgeText(count);
  if (!text) return null;
  return (
    <span
      data-testid="unread-badge"
      aria-hidden
      className={cx(
        "hue-coral anim-pop inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-hue px-1.5 font-display text-[11px] font-black leading-none text-onfill",
        className,
      )}
    >
      {text}
    </span>
  );
}

function useUnreadDescription() {
  const t = useTranslations("chat");
  return (count: number | undefined) => (count && count > 0 ? t("unread", { count }) : undefined);
}

function BubbleSwitcher({ onNew }: { onNew: () => void }) {
  const { bubbles, bubble, setBubbleId } = useBoolaa();
  const { counts } = useChatUnread();
  const describe = useUnreadDescription();
  const t = useTranslations("nav");
  const rowRef = useRef<HTMLDivElement>(null);
  const [pulse, setPulse] = useState<string | null>(null);
  // Keep the active chip in view (centred) when the bubble changes.
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: scrollBehavior() });
  }, [bubble?.id]);
  return (
    <div
      ref={rowRef}
      className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 py-1.5 lg:-mx-1 lg:px-1"
      role="group"
      aria-label={t("yourBubbles")}
      data-testid="bubble-switcher"
    >
      {bubbles.map((b) => {
        const active = b.id === bubble?.id;
        const hue = hueFor(b.id);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => {
              if (!active) setPulse(b.id);
              setBubbleId(b.id);
            }}
            aria-pressed={active}
            aria-description={active ? undefined : describe(counts[b.id]?.unread)}
            data-hue={hue}
            className={cx(
              "chip pl-[11px] transition-[background,color,box-shadow,transform]",
              hueClass(hue),
              active ? "fill-hue" : "bg-card text-fg shadow-[0_0_0_1px_var(--app-line)] hover:bg-hue-wash",
            )}
          >
            {b.logo ? (
              <ChipPhoto
                key={pulse === b.id ? "pulse" : "still"}
                logo={b.logo}
                className={cx(
                  "-my-0.5 h-5 w-5 rounded-full bg-field object-cover",
                  pulse === b.id && "anim-orb-pulse",
                  active ? "ring-[1.5px] ring-white" : "ring-[1.5px] ring-hue/40",
                )}
              />
            ) : (
              <span
                key={pulse === b.id ? "pulse" : "still"}
                className={cx("orb h-4 w-4", pulse === b.id && "anim-orb-pulse", active && "ring-[1.5px] ring-white")}
                aria-hidden
              />
            )}
            {b.name}
            <UnreadBadge count={active ? 0 : counts[b.id]?.unread} className="-mr-1" />
          </button>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        className="chip border-[1.5px] border-dashed border-grape-ink/55 bg-card text-grape-ink hover:bg-[color-mix(in_srgb,var(--grape)_10%,var(--app-card))]"
      >
        <Plus size={16} strokeWidth={3} /> {t("newBubble")}
      </button>
    </div>
  );
}

/**
 * Mobile dock (6.1, 8.3): a glass pill tab bar and the chat orb. The active tab is a pill with icon + label in the
 * feature colour that slides and stretches between tabs (snappy spring); the others are icons. When the label
 * doesn't fit (long translations, 320 px, large text) the pill shrinks to an icon circle and the label lives on
 * only as the accessible name.
 */
const DOCK = { pad: 5, slot: 40, height: 46, pillLead: 12, pillTrail: 14, icon: 20, gap: 6, orb: 60, orbGap: 10 } as const;

function Dock({ pathname, chatLabel }: { pathname: string; chatLabel: string }) {
  const t = useTranslations("nav");
  const index = TABS.findIndex((tab) => pathname.startsWith(tab.href));
  const activeKey = index >= 0 ? TABS[index].key : null;
  const activeHue = activeKey ? FEATURE_HUE[activeKey as keyof typeof FEATURE_HUE] : "grape";
  // Short dock names ("Market", "Agenda") so the active label fits at 390 px in every language (8.3).
  const label = activeKey ? t(`dock.${activeKey}`) : "";
  const rowRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  // Does the label fit? Re-checked when the width, the text size or the label changes.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const probe = probeRef.current;
    if (!row || !probe) return;
    const check = () => {
      const styles = getComputedStyle(row);
      const navMax = row.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight) - DOCK.orb - DOCK.orbGap;
      const pillWidth = DOCK.pillLead + DOCK.icon + DOCK.gap + Math.ceil(probe.scrollWidth) + DOCK.pillTrail;
      setCompact(2 * DOCK.pad + 4 * DOCK.slot + pillWidth > navMax);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(row);
    ro.observe(probe);
    return () => ro.disconnect();
  }, [label]);

  // Where the sliding pill sits: measured from the active tab.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return setPill(null);
    // Icon-only, the pill is a circle centred in its slot; labelled, it is the whole tab.
    const place = () => {
      const w = compact ? Math.min(active.offsetWidth, DOCK.height) : active.offsetWidth;
      setPill({ x: active.offsetLeft + (active.offsetWidth - w) / 2, w });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(active);
    return () => ro.disconnect();
  }, [index, compact, label]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] lg:bottom-8 lg:left-auto lg:right-8"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
    >
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-32 lg:hidden bg-gradient-to-b from-transparent to-[color-mix(in_srgb,var(--app-bg)_92%,transparent)]" />
      <div ref={rowRef} className="relative mx-auto flex max-w-md items-center justify-center gap-2.5 px-4 max-[359px]:px-3 lg:px-0">
        <nav
          ref={navRef}
          aria-label={t("main")}
          data-testid="tab-bar"
          data-compact={compact}
          className="dock-glass pointer-events-auto relative flex min-w-0 flex-1 items-center overflow-hidden rounded-full lg:hidden"
          style={{ padding: DOCK.pad }}
        >
          {/* Measures the label in the pill's font (hidden). */}
          <span ref={probeRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap font-display text-[0.875rem] font-extrabold">
            {label}
          </span>
          {pill && (
            <span
              aria-hidden
              data-testid="tab-indicator"
              className={cx("dock-indicator fill-hue absolute left-0 rounded-full", hueClass(activeHue))}
              style={{ top: DOCK.pad, height: DOCK.height, width: pill.w, transform: `translateX(${pill.x}px)` }}
            />
          )}
          {TABS.map(({ href, key, icon: Icon }, i) => {
            const active = i === index;
            const hue = FEATURE_HUE[key as keyof typeof FEATURE_HUE];
            const labelled = active && !compact;
            return (
              <Link
                key={href}
                href={href}
                aria-label={t(`dock.${key}`)}
                title={labelled ? undefined : t(`dock.${key}`)}
                data-testid={`tab-${key}`}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "press-round relative flex items-center justify-center rounded-full",
                  labelled ? "flex-none" : "flex-1",
                  active ? hueClass(hue) : "text-muted hover:text-fg",
                  // Before the pill is measured (first paint), the active tab draws its own fill.
                  active && !pill && "fill-hue",
                )}
                style={{
                  height: DOCK.height,
                  minWidth: labelled ? undefined : DOCK.slot,
                  paddingInline: labelled ? `${DOCK.pillLead}px ${DOCK.pillTrail}px` : undefined,
                  gap: DOCK.gap,
                  color: active ? "var(--h-on)" : undefined,
                }}
              >
                <Icon size={DOCK.icon} strokeWidth={active ? 2.6 : 2.2} key={active ? "on" : "off"} className={cx("shrink-0", active && "anim-pop")} />
                {labelled && (
                  <span key={label} data-testid="tab-label" className="dock-label whitespace-nowrap font-display text-[0.875rem] font-extrabold">
                    {label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <ChatOrb label={chatLabel} className="pointer-events-auto" />
      </div>
    </div>
  );
}

function ChatOrb({ label, className }: { label: string; className?: string }) {
  const { bubble } = useBoolaa();
  const { counts } = useChatUnread();
  const describe = useUnreadDescription();
  return (
    <Link
      href="/chat"
      aria-label={label}
      aria-description={describe(bubble ? counts[bubble.id]?.unread : 0)}
      data-testid="chat-fab"
      className={cx("press-round ring-pulse orb hue-grape relative flex h-[60px] w-[60px] items-center justify-center text-white", className)}
      style={{ boxShadow: "0 10px 24px -6px color-mix(in srgb, var(--grape) 60%, transparent), inset 0 0 0 2px rgb(255 255 255 / 0.28)" }}
    >
      <MessagesSquare size={24} strokeWidth={2.5} className="relative z-10" />
      <UnreadBadge count={bubble ? counts[bubble.id]?.unread : 0} className="absolute -right-1 -top-1 z-20 ring-2 ring-app" />
    </Link>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  const t = useTranslations("nav");
  const { bubble } = useBoolaa();
  const { counts } = useChatUnread();
  const describe = useUnreadDescription();
  const item = ({ href, key, icon: Icon }: NavItem) => {
    const active = pathname.startsWith(href);
    const hue = FEATURE_HUE[key];
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        aria-description={key === "chat" && !active ? describe(bubble ? counts[bubble.id]?.unread : 0) : undefined}
        data-testid={`nav-${key}`}
        className={cx(
          "press flex min-w-0 items-center gap-3 rounded-full py-1.5 pl-1.5 pr-4 font-display font-bold transition-colors",
          hueClass(hue),
          active ? "bg-hue-wash text-fg" : "text-muted hover:bg-field hover:text-fg",
        )}
      >
        <span
          className={cx(
            "flex h-10 w-10 items-center justify-center rounded-full transition-[background,color,box-shadow]",
            active ? "fill-hue" : "text-hue-ink",
          )}
        >
          <Icon size={20} strokeWidth={active ? 2.6 : 2.2} />
        </span>
        <span className="truncate">{t(key)}</span>
        {key === "chat" && !active && <UnreadBadge count={bubble ? counts[bubble.id]?.unread : 0} className="ml-auto" />}
      </Link>
    );
  };
  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col gap-1 border-r border-line bg-card/60 px-4 py-6 backdrop-blur-xl lg:flex">
      <Link href="/home" className="mb-6 flex items-center gap-2 px-2" aria-label="Boolaa">
        <BubbleLogo size={34} animated={false} />
        <span className="font-display text-[26px] font-black tracking-tight">Boolaa</span>
      </Link>
      <nav aria-label={t("sidebar")} data-testid="sidebar" className="flex flex-col gap-1">
        {TABS.map(item)}
        <div className="my-3 border-t border-line" />
        {EXTRA.map(item)}
      </nav>
    </aside>
  );
}

/**
 * Feature band (8.1): the screen's colour behind the header, two soft circles and a ring, fading out at the
 * header's bottom edge. The bubble's colour lives on the chips, the Home hero and your chat messages.
 */
function BandDeco() {
  return (
    <div aria-hidden className="band-deco">
      <span style={{ width: 220, height: 220, right: -70, top: -110 }} />
      <span style={{ width: 110, height: 110, right: "26%", top: -62 }} />
      <span className="band-ring" style={{ width: 30, height: 30, right: "38%", top: 22 }} />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations();
  const navKey = navKeyFor(pathname);
  const { profile, bubble, refreshBubbles, setBubbleId, lostBubble, dismissLostBubble, live } = useBoolaa();
  const [profileOpen, setProfileOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const isChat = pathname.startsWith("/chat");
  const isSub = isChat || pathname.startsWith("/links");

  const hue = hueFor(bubble?.id);
  const bandKey = navKey ? BAND_HUE[navKey] : "grape";
  const bandHue = bandKey === "bubble" ? hue : bandKey;
  return (
    <div className="isolate min-h-dvh lg:pl-64" data-testid="app-shell" data-live={live}>
      <a
        href="#main"
        data-testid="skip-link"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[500] focus:rounded-full focus:bg-card focus:px-5 focus:py-3 focus:font-display focus:font-bold focus:text-brand-ink focus:shadow-float"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        {t("a11y.skipToContent")}
      </a>
      <DeepLinkTarget />
      <Sidebar pathname={pathname} />
      <div className={cx("flex flex-col", isChat ? "h-dvh" : "min-h-dvh")}>
        <div className="feature-band shrink-0" style={{ "--band": `var(--${bandHue})` } as CSSProperties} data-testid="feature-band" data-hue={bandHue}>
          <BandDeco />
          <header className="mx-auto max-w-4xl px-4 pb-4 pt-6 lg:pt-8">
            <div className="flex items-center gap-3 px-1">
              {isSub && (
                <button
                  type="button"
                  onClick={() => (window.history.length > 1 ? router.back() : router.push("/home"))}
                  aria-label={t("common.back")}
                  className="press-round flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-brand-ink shadow-soft lg:hidden"
                >
                  <ChevronLeft size={24} strokeWidth={2.6} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <h1
                  key={navKey ?? "app"}
                  className={cx("anim-fade screen-title line-clamp-2", isSub && "screen-title-sub")}
                  data-testid="page-title"
                >
                  {/* Brand gradient on Home only: its band is the brand colour (8.5). */}
                  <span className={navKey === "home" ? "text-brand-gradient" : undefined}>{navKey ? t(`nav.${navKey}`) : "Boolaa"}</span>
                </h1>
              </div>
              {bubble && <SearchButton onClick={() => setSearchOpen(true)} />}
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                aria-label={t("nav.profile")}
                data-testid="profile-button"
                className="press-round shrink-0 rounded-full"
              >
                <Avatar name={profile?.name} id={profile?.id} src={profile?.avatar} size={44} decorative />
              </button>
            </div>
            <div className="mt-3">
              <BubbleSwitcher
                onNew={() => {
                  setRequested(false);
                  setNewOpen(true);
                }}
              />
            </div>
          </header>
        </div>
        <div className={cx("mx-auto flex w-full max-w-4xl flex-1 flex-col px-4", isChat && "min-h-0")}>
          {lostBubble && (
            <p
              role="status"
              data-testid="lost-bubble"
              className="hue-sunny anim-pop-soft mb-3 flex items-center gap-2 rounded-field px-4 py-2.5 text-sm font-medium text-hue-ink"
              style={{ background: "linear-gradient(var(--h-wash), var(--h-wash)), var(--app-card)" }}
            >
              <span className="flex-1">{t("shell.lostBubble", { bubble: lostBubble })}</span>
              <button type="button" onClick={dismissLostBubble} aria-label={t("a11y.dismiss")} className="press-round flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-hue-wash">
                <X size={16} />
              </button>
            </p>
          )}
          <ConnectivityBanner />
          <main id="main" tabIndex={-1} key={`${bubble?.id}:${pathname}`} className={cx("anim-route flex-1 outline-none", isChat ? "min-h-0 pb-4" : "pb-36 lg:pb-16")}>
            {children}
          </main>
        </div>
      </div>

      {!isChat && <Dock pathname={pathname} chatLabel={t("nav.openChat")} />}

      <CheerHost />
      <BubbleSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title={t("createJoin.dialogTitle")}>
        {requested ? (
          <div className="space-y-4 text-center">
            <p className="text-lg font-semibold">{t("createJoin.requestSent")}</p>
            <p className="text-muted">{t("createJoin.requestSentHint")}</p>
            <Link href="/onboarding" className="btn-ghost" onClick={() => setNewOpen(false)}>
              {t("createJoin.viewPending")}
            </Link>
          </div>
        ) : (
          <CreateJoinTabs
            onCreated={async (b) => {
              await refreshBubbles();
              setBubbleId(b.id);
              setNewOpen(false);
              router.push("/home");
            }}
            onRequested={() => setRequested(true)}
          />
        )}
      </Modal>
    </div>
  );
}

/** A bubble's photo in the switcher chip (signed URL, lib/storage-url); an empty dot while signing. */
function ChipPhoto({ logo, className }: { logo: string; className?: string }) {
  const photo = useSignedUrl(logo);
  if (!photo.url) return <span className={cx("inline-block", className)} aria-hidden data-testid="bubble-chip-photo" />;
  /* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */
  return <img src={photo.url} onError={photo.onError} alt="" data-testid="bubble-chip-photo" className={className} />;
}
