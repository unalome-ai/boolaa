"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CalendarDays, Link2, MessagesSquare, Sparkles, Tag, UtensilsCrossed } from "lucide-react";
import { FeatureBadge } from "@/components/orb";
import { hueClass, hueFor, type Hue } from "@/lib/hue";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { Avatar, EmptyState, Img, PageLoader, StatusBadge } from "@/components/ui";
import { AUTHOR, type Author, type Row } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/format";
import { PushCard } from "@/components/notification-settings";

type FeedItem = {
  key: string;
  at: string;
  href: string;
  kind: "chat" | "food" | "market" | "event" | "link";
  icon: ReactNode;
  author: Author | null;
  body: ReactNode;
};

const LIMIT = 5;

const KIND_HUE: Record<FeedItem["kind"], Hue> = { chat: "grape", food: "tangerine", market: "mint", event: "coral", link: "sky" };

type FeedData = {
  chat: (Pick<Row<"chat_messages">, "id" | "content" | "image_path" | "created_at"> & { sender: Author | null })[];
  food: (Pick<Row<"food_posts">, "id" | "image" | "description" | "created_at"> & { user: Author | null })[];
  market: (Pick<Row<"market_items">, "id" | "image" | "title" | "status" | "created_at"> & { owner: Author | null })[];
  events: (Pick<Row<"events">, "id" | "title" | "datetime" | "location" | "rsvp_list" | "created_at"> & {
    creator: Author | null;
  })[];
  links: (Pick<Row<"shared_links">, "id" | "url" | "title" | "tags" | "created_at"> & { user: Author | null })[];
};

export default function HomePage() {
  const { supabase, profile } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations();
  const fmt = useFormat();
  const [data, setData] = useState<FeedData | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const now = new Date().toISOString();
      const [chat, food, market, events, links] = await Promise.all([
        supabase
          .from("chat_messages")
          .select(`id, content, image_path, created_at, sender:users!sender_id(${AUTHOR})`)
          .eq("bubble_id", bubble.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        supabase
          .from("food_posts")
          .select(`id, image, description, created_at, user:users!user_id(${AUTHOR})`)
          .eq("bubble_id", bubble.id)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        supabase
          .from("market_items")
          .select(`id, image, title, status, created_at, owner:users!owner_id(${AUTHOR})`)
          .eq("bubble_id", bubble.id)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        supabase
          .from("events")
          .select(`id, title, datetime, location, rsvp_list, created_at, creator:users!creator_id(${AUTHOR})`)
          .eq("bubble_id", bubble.id)
          .gte("datetime", now)
          .order("datetime", { ascending: true })
          .limit(LIMIT),
        supabase
          .from("shared_links")
          .select(`id, url, title, tags, created_at, user:users!user_id(${AUTHOR})`)
          .eq("bubble_id", bubble.id)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
      ]);
      if (!alive) return;
      setData({ chat: chat.data ?? [], food: food.data ?? [], market: market.data ?? [], events: events.data ?? [], links: links.data ?? [] });
    })();
    return () => {
      alive = false;
    };
  }, [supabase, bubble.id]);

  const feed: FeedItem[] | null = data && [
    ...data.chat.map((m) => ({
      key: `chat-${m.id}`,
      at: m.created_at,
      href: "/chat",
      kind: "chat" as const,
      icon: <MessagesSquare size={22} strokeWidth={2.4} />,
      author: m.sender,
      body: <p className="line-clamp-3 text-[16px] font-semibold wrap-anywhere">{m.content || (m.image_path ? `📷 ${t("chat.photo")}` : "")}</p>,
    })),
    ...data.food.map((f) => ({
      key: `food-${f.id}`,
      at: f.created_at,
      href: "/food",
      kind: "food" as const,
      icon: <UtensilsCrossed size={22} strokeWidth={2.4} />,
      author: f.user,
      body: (
        <div className="flex gap-3">
          <Img src={f.image} alt={f.description || t("food.imageAlt")} className="h-[60px] w-[60px] shrink-0 rounded-small object-cover" />
          <p className="text-[15px]">{f.description || t("food.sharedSomeFood")}</p>
        </div>
      ),
    })),
    ...data.market.map((i) => ({
      key: `market-${i.id}`,
      at: i.created_at,
      href: "/marketplace",
      kind: "market" as const,
      icon: <Tag size={22} strokeWidth={2.4} />,
      author: i.owner,
      body: (
        <div className="flex items-center gap-3">
          <Img src={i.image} alt={i.title} className="h-[60px] w-[60px] shrink-0 rounded-small object-cover" />
          <div className="space-y-1.5">
            <p className="font-semibold">{i.title}</p>
            <StatusBadge status={i.status} />
          </div>
        </div>
      ),
    })),
    ...data.events.map((e) => ({
      key: `event-${e.id}`,
      at: e.created_at,
      href: "/events",
      kind: "event" as const,
      icon: <CalendarDays size={22} strokeWidth={2.4} />,
      author: e.creator,
      body: (
        <div>
          <p className="font-semibold">{e.title}</p>
          <p className="text-sm text-muted">
            {fmt.dateTime(e.datetime)}
            {e.location ? ` · ${e.location}` : ""} · {t("events.goingCount", { count: e.rsvp_list.length })}
          </p>
        </div>
      ),
    })),
    ...data.links.map((l) => ({
      key: `link-${l.id}`,
      at: l.created_at,
      href: "/links",
      kind: "link" as const,
      icon: <Link2 size={22} strokeWidth={2.4} />,
      author: l.user,
      body: (
        <div>
          <p className="font-semibold">{l.title || l.url}</p>
          <p className="truncate text-sm text-muted">
            {l.tags.map((tg) => `#${tg}`).join(" ")} {l.url}
          </p>
        </div>
      ),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const hue = hueFor(bubble.id);
  const firstName = profile?.name?.split(" ")[0];
  return (
    <div>
      <PushCard />
      {/* Hero card in the bubble's colour (6.3) */}
      <section
        className={`${hueClass(hue)} anim-pop-soft relative mb-7 overflow-hidden rounded-hero p-5 shadow-glow sm:p-6`}
        style={{ background: "linear-gradient(135deg, var(--h-from), var(--h-to))", color: "var(--h-on)" }}
        data-testid="home-hero"
      >
        <span aria-hidden className="absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/[0.16]" />
        <span aria-hidden className="absolute -bottom-10 right-16 h-28 w-28 rounded-full bg-white/[0.14]" />
        <span aria-hidden className="absolute right-6 top-6 h-8 w-8 rounded-full border-2 border-white/30" />
        <div className="relative">
          {firstName && <p className="text-[15px] font-semibold opacity-90">{t("home.greeting", { name: firstName })}</p>}
          <h2 className="mt-0.5 text-[28px] font-black leading-tight">{bubble.name}</h2>
          {bubble.description && <p className="mt-1 line-clamp-3 max-w-xl text-[15px] opacity-90">{bubble.description}</p>}
          <Link
            href="/links"
            className="press mt-4 inline-flex h-9 items-center gap-1.5 rounded-full px-4 font-display text-[15px] font-bold"
            style={{ background: "color-mix(in srgb, var(--h-on) 16%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--h-on) 25%, transparent)" }}
          >
            <Link2 size={16} strokeWidth={2.6} /> {t("nav.links")}
          </Link>
        </div>
      </section>
      <h2 className="mb-3 text-[20px] font-extrabold">{t("home.whatsNew")}</h2>
      {feed === null ? (
        <PageLoader />
      ) : feed.length === 0 ? (
        <EmptyState icon={<Sparkles size={30} strokeWidth={2.4} />} title={t("home.emptyTitle")} hint={t("home.emptyHint")} hue={hue} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {feed.map((item, i) => (
            <li key={item.key} className={`anim-rise min-w-0 ${hueClass(KIND_HUE[item.kind])}`} style={{ "--i": i } as CSSProperties}>
              <Link href={item.href} className="card press flex h-full gap-3 p-4 hover:shadow-float" data-testid="feed-card">
                <FeatureBadge hue={KIND_HUE[item.kind]}>{item.icon}</FeatureBadge>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2 font-display text-xs font-extrabold uppercase tracking-wide text-hue-ink">
                    <span className="truncate">{t(`home.${item.kind}`)}</span>
                    <span className="ml-auto shrink-0 font-sans text-xs font-normal normal-case tracking-normal text-muted">{fmt.relative(item.at)}</span>
                  </div>
                  {item.body}
                  {item.author && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-muted">
                      <Avatar name={item.author.name} id={item.author.id} src={item.author.avatar} size={22} />
                      {item.author.name}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
