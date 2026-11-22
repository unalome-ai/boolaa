"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MessagesSquare, Send } from "lucide-react";
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
      <div className="mb-2 flex items-center gap-2 text-sm text-muted" data-testid="chat-status" data-live={live}>
        <span className={cx("h-2 w-2 rounded-full", live ? "bg-emerald-500" : "bg-zinc-400")} />
        {bubble.name} · {live ? t("live") : t("connecting")}
      </div>
      <div className="card min-h-0 flex-1 overflow-y-auto p-4" data-testid="chat-list">
        {messages === null ? (
          <PageLoader />
        ) : rendered.length === 0 ? (
          <EmptyState icon={<MessagesSquare size={32} />} title={t("emptyTitle")} hint={t("emptyHint")} />
        ) : (
          <ul className="space-y-3">
            {rendered.map((m, i) => {
              const mine = m.sender_id === userId;
              const prev = rendered[i - 1];
              const grouped = prev && prev.sender_id === m.sender_id;
              return (
                <li
                  key={m.id}
                  data-testid="chat-message"
                  className={cx("flex items-end gap-2", mine ? "flex-row-reverse" : "flex-row", grouped && "-mt-1.5")}
                >
                  <div className="w-8 shrink-0">
                    {!grouped && <Avatar name={m.sender?.name} src={m.sender?.avatar} size={32} />}
                  </div>
                  <div className={cx("flex max-w-[78%] flex-col", mine ? "items-end" : "items-start")}>
                    {!grouped && (
                      <span className="mb-0.5 px-1 text-xs font-medium text-muted">
                        {mine ? tc("you") : (m.sender?.name ?? tc("someone"))}
                      </span>
                    )}
                    <div
                      className={cx(
                        "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px]",
                        mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-brand/15 text-fg",
                      )}
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
      <form onSubmit={send} className="mt-3 flex items-center gap-2">
        <input
          className="input flex-1 rounded-full px-5"
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
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-soft transition hover:bg-brand-dark disabled:opacity-50"
        >
          <Send size={20} />
        </button>
      </form>
    </div>
  );
}
