"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Link2, MessageCircle, Sparkles, Tags, UtensilsCrossed } from "lucide-react";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { Avatar, EmptyState, Img, PageLoader, StatusBadge } from "@/components/ui";
import { AUTHOR, type Author, type Row } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/format";

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

type FeedData = {
  chat: (Pick<Row<"chat_messages">, "id" | "content" | "created_at"> & { sender: Author | null })[];
  food: (Pick<Row<"food_posts">, "id" | "image" | "description" | "created_at"> & { user: Author | null })[];
  market: (Pick<Row<"market_items">, "id" | "image" | "title" | "status" | "created_at"> & { owner: Author | null })[];
  events: (Pick<Row<"events">, "id" | "title" | "datetime" | "location" | "rsvp_list" | "created_at"> & {
    creator: Author | null;
  })[];
  links: (Pick<Row<"shared_links">, "id" | "url" | "title" | "tags" | "created_at"> & { user: Author | null })[];
};

export default function HomePage() {
  const { supabase } = useBoolaa();
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
          .select(`id, content, created_at, sender:users!sender_id(${AUTHOR})`)
          .eq("bubble_id", bubble.id)
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
      icon: <MessageCircle size={16} />,
      author: m.sender,
      body: <p className="text-[15px]">{m.content}</p>,
    })),
    ...data.food.map((f) => ({
      key: `food-${f.id}`,
      at: f.created_at,
      href: "/food",
      kind: "food" as const,
      icon: <UtensilsCrossed size={16} />,
      author: f.user,
      body: (
        <div className="flex gap-3">
          <Img src={f.image} alt={f.description || t("food.imageAlt")} className="h-20 w-20 shrink-0 rounded-xl object-cover" />
          <p className="text-[15px]">{f.description || t("food.sharedSomeFood")}</p>
        </div>
      ),
    })),
    ...data.market.map((i) => ({
      key: `market-${i.id}`,
      at: i.created_at,
      href: "/marketplace",
      kind: "market" as const,
      icon: <Tags size={16} />,
      author: i.owner,
      body: (
        <div className="flex items-center gap-3">
          <Img src={i.image} alt={i.title} className="h-20 w-20 shrink-0 rounded-xl object-cover" />
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
      icon: <CalendarDays size={16} />,
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
      icon: <Link2 size={16} />,
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

  return (
    <div>
      {bubble.description && <p className="mb-4 text-muted">{bubble.description}</p>}
      {feed === null ? (
        <PageLoader />
      ) : feed.length === 0 ? (
        <EmptyState icon={<Sparkles size={32} />} title={t("home.emptyTitle")} hint={t("home.emptyHint")} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {feed.map((item) => (
            <li key={item.key} className="min-w-0">
              <Link href={item.href} className="card block h-full p-4 transition hover:-translate-y-0.5 hover:shadow-float" data-testid="feed-card">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand">
                  {item.icon}
                  <span className="truncate">{t(`home.${item.kind}`)}</span>
                  <span className="ml-auto shrink-0 font-normal normal-case tracking-normal text-muted">{fmt.relative(item.at)}</span>
                </div>
                {item.body}
                {item.author && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-muted">
                    <Avatar name={item.author.name} src={item.author.avatar} size={22} />
                    {item.author.name}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
