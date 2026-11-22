"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import { BubbleLogo } from "@/components/orb";
import { Avatar, Modal } from "@/components/ui";
import { FEATURE_HUE, HUES, hueClass, hueFor, type Hue } from "@/lib/hue";
import { cx } from "@/lib/utils";

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
        "hue-coral anim-pop inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-hue px-1.5 font-display text-[11px] font-black leading-none text-white",
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
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
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
              /* eslint-disable-next-line @next/next/no-img-element -- Supabase storage URL */
              <img
                key={pulse === b.id ? "pulse" : "still"}
                src={b.logo}
                alt=""
                data-testid="bubble-chip-photo"
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
        className="chip border-[1.5px] border-dashed border-grape-ink/55 text-grape-ink hover:bg-brand/10"
      >
        <Plus size={16} strokeWidth={3} /> {t("newBubble")}
      </button>
    </div>
  );
}

/** Mobile dock: pill tab bar with a sliding selection, plus the chat orb (6.1). */
function Dock({ pathname, chatLabel }: { pathname: string; chatLabel: string }) {
  const t = useTranslations("nav");
  const index = TABS.findIndex((tab) => pathname.startsWith(tab.href));
  const activeHue = index >= 0 ? FEATURE_HUE[TABS[index].key as keyof typeof FEATURE_HUE] : "grape";
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] lg:bottom-8 lg:left-auto lg:right-8"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
    >
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-32 lg:hidden bg-gradient-to-b from-transparent to-[color-mix(in_srgb,var(--app-bg)_92%,transparent)]" />
      <div className="relative mx-auto flex max-w-md items-center justify-center gap-2.5 px-4 lg:px-0">
        <nav
          aria-label={t("main")}
          data-testid="tab-bar"
          className="pointer-events-auto relative flex min-w-0 items-center gap-0.5 rounded-full max-lg:flex lg:hidden bg-card/85 p-1.5 shadow-float ring-1 ring-line backdrop-blur-xl"
          style={{ "--tab": "clamp(40px, calc((100vw - 32px - 70px - 12px - 8px) / 5), 52px)" } as CSSProperties}
        >
          {index >= 0 && (
            <span
              aria-hidden
              className={cx("slide fill-hue absolute left-1.5 top-1.5 rounded-full", hueClass(activeHue))}
              style={{
                width: "var(--tab)",
                height: "var(--tab)",
                transform: `translateX(calc(${index} * (var(--tab) + 2px)))`,
                transition: "transform var(--dur-snappy) var(--ease-snappy), background 200ms ease-out",
              }}
            />
          )}
          {TABS.map(({ href, key, icon: Icon }, i) => {
            const active = i === index;
            return (
              <Link
                key={href}
                href={href}
                aria-label={t(key)}
                title={t(key)}
                data-testid={`tab-${key}`}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "press-round relative flex items-center justify-center rounded-full",
                  active ? hueClass(FEATURE_HUE[key as keyof typeof FEATURE_HUE]) : "text-muted hover:text-fg",
                )}
                style={{ width: "var(--tab)", height: "var(--tab)", color: active ? "var(--h-on)" : undefined }}
              >
                <Icon size={21} strokeWidth={active ? 2.6 : 2.2} key={active ? "on" : "off"} className={active ? "anim-pop" : undefined} />
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

/** Soft radial glow in the current bubble's hue behind the header (2.4); cross-fades on change. */
function BubbleGlow({ hue }: { hue: Hue }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[520px] overflow-hidden lg:left-64">
      {HUES.map((h) => (
        <div
          key={h}
          className={cx("absolute inset-0 transition-opacity duration-700", hueClass(h))}
          style={{
            opacity: h === hue ? 1 : 0,
            background:
              "radial-gradient(340px 340px at 100% 0%, color-mix(in srgb, var(--h) var(--glow-a), transparent), transparent)," +
              "radial-gradient(260px 220px at 0% 0%, color-mix(in srgb, var(--h-glow) var(--glow-b), transparent), transparent)",
          }}
        />
      ))}
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
  const isChat = pathname.startsWith("/chat");
  const isSub = isChat || pathname.startsWith("/links");

  const hue = hueFor(bubble?.id);
  return (
    <div className="isolate min-h-dvh lg:pl-64" data-testid="app-shell" data-live={live}>
      <BubbleGlow hue={hue} />
      <DeepLinkTarget />
      <Sidebar pathname={pathname} />
      <div className={cx("mx-auto flex max-w-4xl flex-col px-4", isChat ? "h-dvh" : "min-h-dvh")}>
        <header className="shrink-0 pb-3 pt-6 lg:pt-8">
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
                className={cx("anim-fade truncate font-black tracking-tight", isSub ? "text-[28px] lg:text-[34px]" : "text-[34px] lg:text-4xl")}
                data-testid="page-title"
              >
                {navKey ? t(`nav.${navKey}`) : "Boolaa"}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              aria-label={t("nav.profile")}
              data-testid="profile-button"
              className="press-round rounded-full"
            >
              <Avatar name={profile?.name} id={profile?.id} src={profile?.avatar} size={44} />
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
        {lostBubble && (
          <p
            role="status"
            data-testid="lost-bubble"
            className="hue-sunny anim-pop-soft mb-3 flex items-center gap-2 rounded-field bg-hue-wash px-4 py-2.5 text-sm font-medium text-hue-ink"
          >
            <span className="flex-1">{t("shell.lostBubble", { bubble: lostBubble })}</span>
            <button type="button" onClick={dismissLostBubble} aria-label={t("common.close")} className="press-round shrink-0 rounded-full p-1 hover:bg-hue-wash">
              <X size={16} />
            </button>
          </p>
        )}
        <main key={`${bubble?.id}:${pathname}`} className={cx("anim-route flex-1", isChat ? "min-h-0 pb-4" : "pb-36 lg:pb-16")}>
          {children}
        </main>
      </div>

      {!isChat && <Dock pathname={pathname} chatLabel={t("nav.openChat")} />}

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
