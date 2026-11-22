"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowUp, ImagePlus, MessagesSquare, Trash2, X } from "lucide-react";
import { hueClass, hueFor } from "@/lib/hue";
import { SafetyMenu } from "@/components/safety";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { useChatUnread } from "@/components/chat-unread";
import { Avatar, EmptyState, ErrorText, Modal, PageLoader, Spinner } from "@/components/ui";
import { liveChannel } from "@/lib/realtime";
import { AUTHOR, type Author, type ChatMessage, type Row } from "@/lib/types";
import { CHAT_PAGE, dividerIndex, mergeMessages, removeChatImage, signChatImages, uploadChatImage } from "@/lib/chat";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { cx } from "@/lib/utils";
import { useChatDraft } from "@/lib/chat-draft";
import { useReactions } from "@/lib/reactions";
import { ReactionChips, ReactionPicker } from "@/components/reactions";
import { HIGHLIGHT_EVENT, aroundWindow, type HighlightDetail } from "@/lib/search";

/** Scrolled this close to the top, the next older page loads. */
const TOP_THRESHOLD = 160;
/** Within this distance from the bottom, new messages keep the view pinned to the bottom. */
const BOTTOM_THRESHOLD = 120;
/** How long a message opened from search stays highlighted. */
const HIGHLIGHT_MS = 4000;

export default function ChatPage() {
  const { supabase, userId, profile, blocked } = useBoolaa();
  const bubble = useBubble();
  const unread = useChatUnread();
  const t = useTranslations("chat");
  const ts = useTranslations("search");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const fmt = useFormat();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [authors, setAuthors] = useState<Record<string, Author>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [live, setLive] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Last-read marker from before this visit: where the "New messages" divider goes (undefined = loading).
  const [marker, setMarker] = useState<string | null | undefined>(undefined);
  // Messages present at first load don't animate; later ones pop in from their tail corner.
  const [initialIds, setInitialIds] = useState<Set<string> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const pinned = useRef(true);
  const lastMarked = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Message whose reaction picker is open (button, or right-click on the bubble).
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const liveIds = useMemo(() => (messages ?? []).filter((m) => !m.deleted_at).map((m) => m.id), [messages]);
  const reactions = useReactions({ supabase, bubbleId: bubble.id, type: "chat_message", targetIds: liveIds, userId, onError: (e) => setError(errorText(e)) });
  const { bind: bindReactions, reload: reloadReactions, dropTarget } = reactions;
  // A message opened from search (docs/boolaa-spec.md, "Search"): scrolled to and highlighted once rendered.
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const lastJump = useRef<{ id: string; at: number } | null>(null);

  // A prefilled message from elsewhere ("Ask in chat" on a market item): put it in the composer, unsent.
  const onDraft = useCallback((draft: string) => {
    setText(draft);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(draft.length, draft.length);
    });
  }, []);
  useChatDraft(bubble.id, onDraft);

  const page = useCallback(
    (before: string | null) =>
      supabase
        .rpc("chat_messages_page", { p_bubble_id: bubble.id, p_before_id: before ?? undefined, p_limit: CHAT_PAGE })
        .select(`*, sender:users!sender_id(${AUTHOR})`)
        .returns<ChatMessage[]>(),
    [supabase, bubble.id],
  );

  // Marker first (before this visit marks anything read), then history + members, then live.
  useEffect(() => {
    let alive = true;
    const merge = (rows: ChatMessage[]) => setMessages((prev) => mergeMessages(prev ?? [], rows));

    unread.load(bubble.id).then((entry) => alive && setMarker(entry?.lastReadAt ?? null));

    (async () => {
      const [hist, members] = await Promise.all([
        page(null),
        supabase.from("bubble_members").select(`user:users!user_id(${AUTHOR})`).eq("bubble_id", bubble.id),
      ]);
      if (!alive) return;
      if (hist.error) setLoadError(hist.error);
      const rows = hist.data ?? [];
      setHasMore(rows.length === CHAT_PAGE);
      setMessages((prev) => mergeMessages(prev ?? [], rows));
      setInitialIds(new Set(rows.map((m) => m.id)));
      const dir: Record<string, Author> = {};
      members.data?.forEach((m) => m.user && (dir[m.user.id] = m.user));
      setAuthors(dir);
    })();

    // INSERT adds, UPDATE replaces in place (a deletion arrives as an UPDATE with deleted_at set).
    const filter = `bubble_id=eq.${bubble.id}`;
    const onRow = (payload: { new: unknown }) => {
      const row = payload.new as Row<"chat_messages">;
      if (row.deleted_at) dropTarget(row.id); // a deleted message loses its reactions
      merge([{ ...row, sender: null }]);
    };
    const unsubscribe = liveChannel(
      supabase,
      `chat:${bubble.id}`,
      (ch) =>
        bindReactions(ch)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter }, onRow)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter }, onRow),
      async (ready) => {
        if (!ready) return alive && setLive(false);
        // Streaming has started: pick up messages sent or deleted between the history load and now.
        const { data } = await page(null);
        if (!alive) return;
        if (data) merge(data);
        void reloadReactions();
        setLive(true);
      },
    );

    return () => {
      alive = false;
      unsubscribe();
    };
    // `unread` changes identity with every count; only its stable `load` is used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, bubble.id, page, bindReactions, reloadReactions, dropTarget]);

  const loadOlder = useCallback(async () => {
    const el = listRef.current;
    const oldest = messages?.[0];
    if (!el || !oldest || !hasMore || loadingOlder) return;
    setLoadingOlder(true);
    const { data, error } = await page(oldest.id);
    setLoadingOlder(false);
    if (error) return setLoadError(error);
    const rows = data ?? [];
    setHasMore(rows.length === CHAT_PAGE);
    // Keep the message that was on top where it is: restore the offset from the bottom of the content.
    anchor.current = { height: el.scrollHeight, top: el.scrollTop };
    setMessages((prev) => mergeMessages(prev ?? [], rows));
  }, [messages, hasMore, loadingOlder, page]);

  // Load the window from the message to the newest one (contiguous with what's loaded, so live
  // messages and older pages keep working), then scroll to it and highlight it.
  const jump = useCallback(
    async (id: string) => {
      const now = Date.now();
      if (lastJump.current?.id === id && now - lastJump.current.at < 3000) return; // URL + event for one tap
      lastJump.current = { id, at: now };
      const { data, error } = await supabase
        .rpc("chat_messages_around", { p_bubble_id: bubble.id, p_message_id: id })
        .select(`*, sender:users!sender_id(${AUTHOR})`)
        .returns<ChatMessage[]>();
      if (error) return setLoadError(error);
      const rows = data ?? [];
      const win = aroundWindow(rows, id);
      if (!win.found) return setError(ts("messageUnavailable"));
      if (win.startReached) setHasMore(false); // the window holds the first message
      pinned.current = false;
      setMessages((prev) => mergeMessages(prev ?? [], rows));
      setJumpTo(id);
    },
    [supabase, bubble.id, ts],
  );

  // Opened as /chat?message=<id>, or told by search while this route is mounted (possibly hidden).
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("message");
    if (id) {
      url.searchParams.delete("message");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async load, state is set after the RPC
      void jump(id);
    }
    const onHighlight = (e: Event) => {
      const d = (e as CustomEvent<HighlightDetail>).detail;
      if (d?.path === "/chat") void jump(d.id);
    };
    window.addEventListener(HIGHLIGHT_EVENT, onHighlight);
    return () => window.removeEventListener(HIGHLIGHT_EVENT, onHighlight);
  }, [jump]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    if (el.scrollTop < TOP_THRESHOLD) void loadOlder();
  };

  const newestId = messages?.[messages.length - 1]?.id ?? null;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
      anchor.current = null;
      return;
    }
    const mine = messages?.[messages.length - 1]?.sender_id === userId;
    if (pinned.current || mine) el.scrollTop = el.scrollHeight;
    // Only a new newest message moves the view; edits in place (deletions) don't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, messages?.length]);

  // A short first page can't scroll: load older pages until it can (or the chat starts).
  useEffect(() => {
    const el = listRef.current;
    if (el && hasMore && !loadingOlder && el.scrollHeight <= el.clientHeight + TOP_THRESHOLD) void loadOlder();
  }, [hasMore, loadingOlder, loadOlder, messages?.length]);

  // Mark read up to the newest message while the chat is actually on screen (after the marker was read).
  const unreadMarkRead = unread.markRead;
  useEffect(() => {
    if (marker === undefined || !newestId) return;
    const mark = () => {
      if (document.visibilityState !== "visible" || lastMarked.current === newestId) return;
      lastMarked.current = newestId;
      void unreadMarkRead(bubble.id, newestId);
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [marker, newestId, bubble.id, unreadMarkRead]);

  // Signed URLs for the photos on screen (private bucket), one batch per change.
  const missing = useMemo(
    () => (messages ?? []).flatMap((m) => (m.image_path && !urls[m.image_path] ? [m.image_path] : [])),
    [messages, urls],
  );
  useEffect(() => {
    if (missing.length === 0) return;
    let alive = true;
    signChatImages(supabase, missing).then((got) => alive && setUrls((u) => ({ ...u, ...got })));
    return () => {
      alive = false;
    };
  }, [supabase, missing]);

  // Fill in sender info for realtime rows (payload has no joins).
  const rendered = useMemo(
    () =>
      (messages ?? []).filter((m) => !blocked.has(m.sender_id)).map((m) => ({
        ...m,
        sender: m.sender ?? authors[m.sender_id] ?? (m.sender_id === userId && profile ? profile : null),
      })),
    [messages, authors, userId, profile, blocked],
  );
  const divider = marker === undefined ? -1 : dividerIndex(rendered, marker, userId);

  useEffect(() => {
    if (!jumpTo) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-testid="chat-message"][data-id="${CSS.escape(jumpTo)}"]`);
    if (!el) return; // not rendered yet (or hidden by a block): wait for the next render
    setJumpTo(null);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    el.dataset.highlight = "true";
    setTimeout(() => delete el.dataset.highlight, HIGHLIGHT_MS);
  }, [jumpTo, rendered]);

  function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (photo) URL.revokeObjectURL(photo.preview);
    setPhoto({ file, preview: URL.createObjectURL(file) });
    setError(null);
  }
  function clearPhoto() {
    if (photo) URL.revokeObjectURL(photo.preview);
    setPhoto(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content && !photo) return;
    setSending(true);
    setError(null);
    let path: string | null = null;
    try {
      if (photo) path = await uploadChatImage(supabase, userId, photo.file);
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({ bubble_id: bubble.id, sender_id: userId, content, ...(path ? { image_path: path } : {}) })
        .select(`*, sender:users!sender_id(${AUTHOR})`)
        .single();
      if (error) throw error;
      setText("");
      clearPhoto();
      pinned.current = true;
      setMessages((prev) => mergeMessages(prev ?? [], [data]));
    } catch (err) {
      if (path) void removeChatImage(supabase, path); // the message never referenced it
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage() {
    const m = confirmDelete;
    if (!m) return;
    setDeleting(true);
    const { data, error } = await supabase.rpc("delete_chat_message", { p_message_id: m.id });
    setDeleting(false);
    setConfirmDelete(null);
    if (error) return setError(errorText(error));
    const gone = (data as { image_path?: string | null } | null)?.image_path;
    void removeChatImage(supabase, gone);
    dropTarget(m.id);
    setMessages((prev) =>
      mergeMessages(prev ?? [], [{ ...m, content: "", image_path: null, deleted_at: new Date().toISOString() }]),
    );
  }

  const canSend = !!text.trim() || !!photo;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2 px-1 font-display text-sm font-bold text-muted" data-testid="chat-status" data-live={live}>
        <span className={cx("h-2 w-2 rounded-full transition-colors", live ? "bg-mint" : "bg-muted/50")} />
        {bubble.name} · {live ? t("live") : t("connecting")}
      </div>
      <div
        ref={listRef}
        onScroll={onScroll}
        className="scrollbar-none min-h-0 flex-1 overflow-y-auto rounded-hero bg-card/50 p-4 shadow-soft backdrop-blur-xl"
        data-testid="chat-list"
      >
        {messages === null ? (
          <PageLoader />
        ) : rendered.length === 0 ? (
          <EmptyState icon={<MessagesSquare size={30} strokeWidth={2.4} />} title={t("emptyTitle")} hint={t("emptyHint")} hue="grape" />
        ) : (
          <>
            <div className="flex min-h-8 items-center justify-center pb-3 text-xs font-bold text-muted" data-testid="chat-top">
              {loadingOlder ? (
                <span className="flex items-center gap-2" data-testid="chat-loading-older">
                  <Spinner className="h-4 w-4" /> {t("loadingOlder")}
                </span>
              ) : !hasMore ? (
                <span data-testid="chat-start">{t("chatStart")}</span>
              ) : null}
            </div>
            <ul className="space-y-3">
              {rendered.map((m, i) => {
                const mine = m.sender_id === userId;
                const prev = rendered[i - 1];
                const grouped = prev && prev.sender_id === m.sender_id && i !== divider;
                const fresh = initialIds !== null && !initialIds.has(m.id);
                const deleted = !!m.deleted_at;
                const url = m.image_path ? urls[m.image_path] : undefined;
                return (
                  <li key={m.id} className="space-y-3">
                    {i === divider && (
                      <div className="hue-coral flex items-center gap-3 py-1" role="separator" data-testid="chat-new-divider">
                        <span className="h-px flex-1 bg-hue/50" />
                        <span className="font-display text-xs font-extrabold text-hue-ink">{t("newMessages")}</span>
                        <span className="h-px flex-1 bg-hue/50" />
                      </div>
                    )}
                    <div
                      data-testid="chat-message"
                      data-deleted={deleted}
                      data-id={m.id}
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
                        {deleted ? (
                          <div className="rounded-[21px] border-[1.5px] border-dashed border-line px-4 py-2.5 text-[15px] italic text-muted" data-testid="chat-deleted">
                            {t("deleted")}
                          </div>
                        ) : (
                          <div
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setPickerFor(m.id);
                            }}
                            className={cx(
                              "overflow-hidden whitespace-pre-wrap break-words rounded-[21px] text-[16px] leading-snug",
                              mine ? "hue-grape rounded-br-[6px] bg-hue-grad text-white shadow-glow" : "rounded-bl-[6px] bg-card text-fg shadow-soft",
                              fresh && "anim-pop",
                              !m.image_path && "px-4 py-2.5",
                            )}
                            style={fresh ? { transformOrigin: mine ? "bottom right" : "bottom left" } : undefined}
                          >
                            {m.image_path && (
                              <a href={url} target="_blank" rel="noreferrer" className="block" aria-label={t("photo")}>
                                {url ? (
                                  /* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */
                                  <img
                                    src={url}
                                    alt={t("photo")}
                                    loading="lazy"
                                    data-testid="chat-photo"
                                    className="max-h-80 w-full min-w-48 object-cover"
                                  />
                                ) : (
                                  <span className="flex h-48 w-60 items-center justify-center bg-field">
                                    <Spinner className="h-5 w-5" />
                                  </span>
                                )}
                              </a>
                            )}
                            {m.content && <div className={cx(m.image_path && "px-4 py-2.5")}>{m.content}</div>}
                          </div>
                        )}
                        {!deleted && <ReactionChips state={reactions} targetId={m.id} className={cx("hue-grape mt-1", mine && "justify-end")} />}
                        <span className={cx("mt-0.5 flex items-center gap-1 px-1 text-[11px] text-muted", mine && "flex-row-reverse")}>
                          {fmt.time(m.created_at)}
                          {!deleted && (
                            <ReactionPicker
                              compact
                              align={mine ? "right" : "left"}
                              open={pickerFor === m.id}
                              onOpenChange={(o) => setPickerFor(o ? m.id : null)}
                              onPick={(r) => void reactions.toggle(m.id, r)}
                            />
                          )}
                          {!mine && !deleted && (
                            <SafetyMenu type="chat_message" id={m.id} author={m.sender ? { id: m.sender_id, name: m.sender.name } : { id: m.sender_id, name: null }} compact />
                          )}
                          {mine && !deleted && (
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(m)}
                              aria-label={t("deleteMessage")}
                              title={t("deleteMessage")}
                              data-testid="chat-delete"
                              className="press-round rounded-full p-1 text-muted hover:bg-field hover:text-fg"
                            >
                              <Trash2 size={13} strokeWidth={2.4} />
                            </button>
                          )}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      <ErrorText>{error ?? (loadError ? errorText(loadError) : null)}</ErrorText>
      {photo && (
        <div className="mt-3 flex items-center gap-2 px-1" data-testid="chat-photo-preview">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={photo.preview} alt={tc("selectedPhoto")} className="h-16 w-16 rounded-small object-cover shadow-soft" />
            <button
              type="button"
              onClick={clearPhoto}
              aria-label={t("removePhoto")}
              data-testid="chat-photo-remove"
              className="press-round absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-fg text-card shadow-soft"
            >
              <X size={14} strokeWidth={3} />
            </button>
          </div>
        </div>
      )}
      <form onSubmit={send} className="mt-3 flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="chat-photo-input"
          onChange={(e) => pickPhoto(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={t("addPhoto")}
          title={t("addPhoto")}
          data-testid="chat-add-photo"
          disabled={sending}
          className="press-round hue-grape flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-card text-hue-ink shadow-soft"
        >
          <ImagePlus size={22} strokeWidth={2.4} />
        </button>
        <input
          className="min-h-12 w-full flex-1 rounded-[24px] border-2 border-transparent bg-card px-5 text-[16px] text-fg shadow-soft outline-none transition-[border-color] duration-200 placeholder:text-muted focus:border-grape"
          placeholder={t("placeholder", { bubble: bubble.name })}
          aria-label={t("messageLabel")}
          data-testid="chat-input"
          ref={inputRef}
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          aria-label={t("send")}
          data-testid="chat-send"
          disabled={sending || !canSend}
          className={cx(
            "press-round flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-[background,color,box-shadow] duration-200",
            canSend ? "hue-grape fill-hue" : "bg-field text-muted",
          )}
        >
          {sending ? <Spinner className="h-5 w-5" /> : <ArrowUp key={canSend ? "ready" : "idle"} size={22} strokeWidth={3} className={canSend ? "anim-pop" : undefined} />}
        </button>
      </form>
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={t("deleteConfirmTitle")}>
        <p className="text-muted">{t("deleteConfirmBody")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(null)}>
            {tc("cancel")}
          </button>
          <button type="button" className="btn-danger" data-testid="chat-delete-confirm" disabled={deleting} onClick={deleteMessage}>
            {t("deleteConfirm")}
          </button>
        </div>
      </Modal>
    </div>
  );
}
