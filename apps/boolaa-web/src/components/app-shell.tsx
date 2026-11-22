"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronLeft,
  Home,
  Link2,
  MessageCircle,
  Plus,
  Settings,
  Tags,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useBoolaa } from "@/components/boolaa-provider";
import { CreateJoinTabs } from "@/components/create-join";
import { ProfileSheet } from "@/components/profile-sheet";
import { Avatar, Modal } from "@/components/ui";
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
  { href: "/chat", key: "chat", icon: MessageCircle },
  { href: "/links", key: "links", icon: Link2 },
];

function navKeyFor(pathname: string): NavKey | null {
  return [...TABS, ...EXTRA].find((t) => pathname.startsWith(t.href))?.key ?? null;
}

function BubbleSwitcher({ onNew }: { onNew: () => void }) {
  const { bubbles, bubble, setBubbleId } = useBoolaa();
  const t = useTranslations("nav");
  return (
    <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 py-1" role="group" aria-label={t("yourBubbles")} data-testid="bubble-switcher">
      {bubbles.map((b) => {
        const active = b.id === bubble?.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => setBubbleId(b.id)}
            aria-pressed={active}
            className={cx(
              "chip border-2",
              active
                ? "border-accent bg-brand text-white shadow-soft"
                : "border-transparent bg-chip text-brand hover:bg-brand/15",
            )}
          >
            {b.name}
          </button>
        );
      })}
      <button type="button" onClick={onNew} className="chip border-2 border-brand text-brand hover:bg-brand/10">
        <Plus size={16} /> {t("newBubble")}
      </button>
    </div>
  );
}

function PillTabBar({ pathname }: { pathname: string }) {
  const t = useTranslations("nav");
  return (
    <nav
      aria-label={t("main")}
      data-testid="tab-bar"
      className="fixed inset-x-0 bottom-5 z-[100] flex justify-center px-4 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center gap-1 rounded-full bg-card px-3 py-2 shadow-float sm:gap-3">
        {TABS.map(({ href, key, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-label={t(key)}
              title={t(key)}
              data-testid={`tab-${key}`}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex h-12 w-12 items-center justify-center rounded-full transition",
                active ? "bg-brand text-white" : "text-brand hover:bg-brand/10",
              )}
            >
              <Icon size={22} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  const t = useTranslations("nav");
  const item = ({ href, key, icon: Icon }: NavItem) => {
    const active = pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        data-testid={`nav-${key}`}
        className={cx(
          "flex min-w-0 items-center gap-3 rounded-full py-1.5 pl-1.5 pr-4 font-medium transition",
          active ? "bg-brand/12 text-fg" : "text-muted hover:bg-chip hover:text-fg",
        )}
      >
        <span
          className={cx(
            "flex h-10 w-10 items-center justify-center rounded-full",
            active ? "bg-brand text-white" : "text-brand",
          )}
        >
          <Icon size={20} />
        </span>
        <span className="truncate">{t(key)}</span>
      </Link>
    );
  };
  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col gap-1 border-r border-line bg-card/60 px-4 py-6 backdrop-blur lg:flex">
      <Link href="/home" className="mb-6 flex items-center gap-2 px-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-lg font-black text-white">
          b
        </span>
        <span className="text-2xl font-black tracking-tight text-brand">boolaa</span>
      </Link>
      <nav aria-label={t("sidebar")} data-testid="sidebar" className="flex flex-col gap-1">
        {TABS.map(item)}
        <div className="my-3 border-t border-line" />
        {EXTRA.map(item)}
      </nav>
    </aside>
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

  return (
    <div className="min-h-dvh lg:pl-64" data-testid="app-shell" data-live={live}>
      <Sidebar pathname={pathname} />
      <div className={cx("mx-auto flex max-w-4xl flex-col px-4", isChat ? "h-dvh" : "min-h-dvh")}>
        <header className="shrink-0 pb-3 pt-6 lg:pt-8">
          <div className="flex items-center gap-3">
            {isSub && (
              <button
                type="button"
                onClick={() => (window.history.length > 1 ? router.back() : router.push("/home"))}
                aria-label={t("common.back")}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-chip text-brand lg:hidden"
              >
                <ChevronLeft size={22} />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-3xl font-bold tracking-tight lg:text-4xl" data-testid="page-title">
                {navKey ? t(`nav.${navKey}`) : "Boolaa"}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              aria-label={t("nav.profile")}
              data-testid="profile-button"
              className="rounded-full transition hover:opacity-90"
            >
              <Avatar name={profile?.name} src={profile?.avatar} size={42} />
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
            className="mb-3 flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
          >
            <span className="flex-1">{t("shell.lostBubble", { bubble: lostBubble })}</span>
            <button type="button" onClick={dismissLostBubble} aria-label={t("common.close")} className="shrink-0 rounded-full p-1 hover:bg-amber-500/15">
              <X size={16} />
            </button>
          </p>
        )}
        <main key={bubble?.id} className={cx("flex-1", isChat ? "min-h-0 pb-4" : "pb-40 lg:pb-16")}>
          {children}
        </main>
      </div>

      {!isChat && <PillTabBar pathname={pathname} />}
      {!isChat && (
        <Link
          href="/chat"
          aria-label={t("nav.openChat")}
          data-testid="chat-fab"
          className="fixed bottom-28 right-5 z-[200] flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-float transition hover:bg-brand-dark active:scale-95 lg:bottom-8 lg:right-8"
        >
          <MessageCircle size={24} />
        </Link>
      )}

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
