"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowUp, MessagesSquare } from "lucide-react";
import { hueClass, hueFor } from "@/lib/hue";
import { SafetyMenu } from "@/components/safety";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { Avatar, EmptyState, ErrorText, PageLoader } from "@/components/ui";
import { liveChannel } from "@/lib/realtime";
import { AUTHOR, type Author, type ChatMessage, type Row } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { cx } from "@/lib/utils";

const PAGE = 200;

export default function ChatPage() {
  const { supabase, userId, profile, blocked } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations("chat");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const fmt = useFormat();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [authors, setAuthors] = useState<Record<string, Author>>({});
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [live, setLive] = useState(false);
  // Messages present at first load don't animate; later ones pop in from their tail corner.
  const [initialIds, setInitialIds] = useState<Set<string> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load history + member directory, then subscribe to realtime INSERTs for this bubble.
  useEffect(() => {
    let alive = true;
    const add = (msg: ChatMessage) =>
      setMessages((prev) => {
        if (!prev) return [msg];
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg].sort((a, b) => a.created_at.localeCompare(b.created_at));
      });

    (async () => {
      const [hist, members] = await Promise.all([
        supabase
          .from("chat_messages")
          .select(`*, sender:users!sender_id(${AUTHOR})`)
          .eq("bubble_id", bubble.id)
          .order("created_at", { ascending: false })
          .limit(PAGE),
        supabase.from("bubble_members").select(`user:users!user_id(${AUTHOR})`).eq("bubble_id", bubble.id),
      ]);
      if (!alive) return;
      if (hist.error) setLoadError(hist.error);
      setMessages((hist.data ?? []).reverse());
      setInitialIds(new Set((hist.data ?? []).map((m) => m.id)));
      const dir: Record<string, Author> = {};
      members.data?.forEach((m) => m.user && (dir[m.user.id] = m.user));
      setAuthors(dir);
    })();

    const unsubscribe = liveChannel(
      supabase,
      `chat:${bubble.id}`,
      (ch) =>
        ch.on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages", filter: `bubble_id=eq.${bubble.id}` },
          (payload) => add({ ...(payload.new as Row<"chat_messages">), sender: null }),
        ),
      async (ready) => {
        if (!ready) return alive && setLive(false);
        // Streaming has started: pick up messages sent between the history load and now.
        const { data } = await supabase
          .from("chat_messages")
          .select(`*, sender:users!sender_id(${AUTHOR})`)
          .eq("bubble_id", bubble.id)
          .order("created_at", { ascending: false })
          .limit(PAGE);
        if (!alive) return;
        data?.forEach(add);
        setLive(true);
      },
    );

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [supabase, bubble.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages?.length]);

  // Fill in sender info for realtime rows (payload has no joins).
  const rendered = useMemo(
    () =>
      (messages ?? []).filter((m) => !blocked.has(m.sender_id)).map((m) => ({
        ...m,
        sender: m.sender ?? authors[m.sender_id] ?? (m.sender_id === userId && profile ? profile : null),
      })),
    [messages, authors, userId, profile, blocked],
  );

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ bubble_id: bubble.id, sender_id: userId, content })
      .select(`*, sender:users!sender_id(${AUTHOR})`)
      .single();
    setSending(false);
    if (error) return setError(errorText(error));
    setText("");
    setMessages((prev) => (prev?.some((m) => m.id === data.id) ? prev : [...(prev ?? []), data]));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2 px-1 font-display text-sm font-bold text-muted" data-testid="chat-status" data-live={live}>
        <span className={cx("h-2 w-2 rounded-full transition-colors", live ? "bg-mint" : "bg-muted/50")} />
        {bubble.name} · {live ? t("live") : t("connecting")}
      </div>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto rounded-hero bg-card/50 p-4 shadow-soft backdrop-blur-xl" data-testid="chat-list">
        {messages === null ? (
          <PageLoader />
        ) : rendered.length === 0 ? (
          <EmptyState icon={<MessagesSquare size={30} strokeWidth={2.4} />} title={t("emptyTitle")} hint={t("emptyHint")} hue="grape" />
        ) : (
          <ul className="space-y-3">
            {rendered.map((m, i) => {
              const mine = m.sender_id === userId;
              const prev = rendered[i - 1];
              const grouped = prev && prev.sender_id === m.sender_id;
              const fresh = initialIds !== null && !initialIds.has(m.id);
              return (
                <li
                  key={m.id}
                  data-testid="chat-message"
                  className={cx("flex items-end gap-2", mine ? "flex-row-reverse" : "flex-row", grouped && "-mt-1.5", hueClass(hueFor(m.sender_id)))}
                >
                  {!mine && (
                    <div className="w-[30px] shrink-0">
                      {!grouped && <Avatar name={m.sender?.name} id={m.sender_id} src={m.sender?.avatar} size={30} />}
                    </div>
                  )}
                  <div className={cx("flex max-w-[78%] flex-col", mine ? "items-end" : "items-start")}>
                    {!grouped && (
                      <span className={cx("mb-0.5 px-1 font-display text-xs font-extrabold", mine ? "text-muted" : "text-hue-ink")}>
                        {mine ? tc("you") : (m.sender?.name ?? tc("someone"))}
                      </span>
                    )}
                    <div
                      className={cx(
                        "whitespace-pre-wrap break-words rounded-[21px] px-4 py-2.5 text-[16px] leading-snug",
                        mine ? "hue-grape rounded-br-[6px] bg-hue-grad text-white shadow-glow" : "rounded-bl-[6px] bg-card text-fg shadow-soft",
                        fresh && "anim-pop",
                      )}
                      style={fresh ? { transformOrigin: mine ? "bottom right" : "bottom left" } : undefined}
                    >
                      {m.content}
                    </div>
                    <span className={cx("mt-0.5 flex items-center gap-1 px-1 text-[11px] text-muted", mine && "flex-row-reverse")}>
                      {fmt.time(m.created_at)}
                      {!mine && <SafetyMenu type="chat_message" id={m.id} author={m.sender ? { id: m.sender_id, name: m.sender.name } : { id: m.sender_id, name: null }} compact />}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>
      <ErrorText>{error ?? (loadError ? errorText(loadError) : null)}</ErrorText>
      <form onSubmit={send} className="mt-3 flex items-end gap-2">
        <input
          className="min-h-12 w-full flex-1 rounded-[24px] border-2 border-transparent bg-card px-5 text-[16px] text-fg shadow-soft outline-none transition-[border-color] duration-200 placeholder:text-muted focus:border-grape"
          placeholder={t("placeholder", { bubble: bubble.name })}
          aria-label={t("messageLabel")}
          data-testid="chat-input"
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          aria-label={t("send")}
          data-testid="chat-send"
          disabled={sending || !text.trim()}
          className={cx(
            "press-round flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-[background,color,box-shadow] duration-200",
            text.trim() ? "hue-grape fill-hue" : "bg-field text-muted",
          )}
        >
          <ArrowUp key={text.trim() ? "ready" : "idle"} size={22} strokeWidth={3} className={text.trim() ? "anim-pop" : undefined} />
        </button>
      </form>
    </div>
  );
}
