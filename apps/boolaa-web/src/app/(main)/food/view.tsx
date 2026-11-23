"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { SafetyMenu } from "@/components/safety";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { byCreatedDesc, useChainedBind, useLiveFeed } from "@/lib/live-feed";
import { Avatar, EmptyState, ErrorText, ImagePicker, Img, Modal, PageLoader, SectionTitle } from "@/components/ui";
import { LoadError, StaleNotice, useCachedState, useResilientLoad } from "@/components/offline";
import { AUTHOR, type FoodPost } from "@/lib/types";
import { useTranslations } from "next-intl";
import { cheer } from "@/components/cheer";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { removeImage, uploadImage } from "@/lib/utils";
import { useItemRequests, useRequestUI, type RequestableItem } from "@/components/requests";
import { FoodExpiryLabel, GoodUntilField } from "@/components/food-expiry";
import { foodVisible, nextExpiry, presetValue } from "@/lib/food-expiry";
import { useReactions } from "@/lib/reactions";
import { ReactionBar } from "@/components/reactions";

export default function FoodPage() {
  const { supabase, userId, blocked, profile } = useBoolaa();
  const t = useTranslations();
  const errorText = useErrorText();
  const fmt = useFormat();
  const bubble = useBubble();
  // The last view shows at once (also offline); the load below refreshes it.
  const [posts, setPosts] = useCachedState<FoodPost[]>(`food.${bubble.id}`);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FoodPost | "new" | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("food_posts")
      .select(`*, user:users!user_id(${AUTHOR})`)
      .eq("bubble_id", bubble.id)
      .order("created_at", { ascending: false });
    if (error) return false; // keeps what is on screen; LoadError / StaleNotice offer Try again
    setPosts(data ?? []);
    return true;
  }, [supabase, bubble.id, setPosts]);

  const sync = useResilientLoad(load);

  // Expired posts leave the screen when their time passes (nothing is sent when food expires): a tick every
  // minute for the labels, plus one at the earliest expiry on screen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  const next = posts ? nextExpiry(posts, now) : null;
  useEffect(() => {
    if (next === null) return;
    const at = setTimeout(() => setNow(Date.now()), Math.min(next - Date.now() + 50, 2 ** 31 - 1));
    return () => clearTimeout(at);
  }, [next]);

  const requests = useItemRequests({
    supabase,
    bubbleId: bubble.id,
    kind: "food",
    userId,
    me: profile ? { id: profile.id, name: profile.name, avatar: profile.avatar } : null,
    patchItem: (id, patch) => setPosts((prev) => prev?.map((p) => (p.id === id ? { ...p, ...patch } : p)) ?? null),
    reloadAll: () => Promise.all([load(), requests.reload()]),
    onError: (e) => setError(errorText(e)),
  });
  const requestsReload = requests.reload;
  const listLoaded = posts !== null;
  useEffect(() => {
    // After the list loads (and per bubble); live changes keep it current afterwards.
    if (listLoaded) void requestsReload();
  }, [listLoaded, requestsReload]);

  // Other members' changes stream in (Realtime, filtered by bubble, RLS-checked).
  const reactions = useReactions({ supabase, bubbleId: bubble.id, type: "food_post", targetIds: posts?.map((p) => p.id) ?? [], userId, onError: (e) => setError(errorText(e)) });
  const bindAll = useChainedBind(reactions.bind, requests.bind);
  useLiveFeed<FoodPost>({
    supabase,
    table: "food_posts",
    bubbleId: bubble.id,
    select: `*, user:users!user_id(${AUTHOR})`,
    rows: posts,
    setRows: setPosts,
    compare: byCreatedDesc,
    reload: () => Promise.all([load(), reactions.reload(), requests.reload()]),
    extend: bindAll,
  });

  async function remove(p: FoodPost) {
    if (!window.confirm(t("food.confirmDelete"))) return;
    const { error } = await supabase.from("food_posts").delete().eq("id", p.id);
    if (error) return setError(errorText(error));
    await removeImage(supabase, "food.images", p.image);
    void load();
  }

  // Handed-over and expired posts are never shown (also when the cache or a live update still has them).
  const shownPosts = useMemo(() => posts?.filter((p) => foodVisible(p, now)) ?? null, [posts, now]);
  const mine = shownPosts?.filter((p) => p.user_id === userId) ?? [];
  const others = shownPosts?.filter((p) => p.user_id !== userId && !blocked.has(p.user_id)) ?? [];
  const requestable = useMemo<RequestableItem[] | null>(
    () =>
      shownPosts?.map((p) => ({
        id: p.id,
        ownerId: p.user_id,
        ownerName: p.user?.name ?? t("common.someone"),
        title: p.description ?? "",
        availability: p.availability,
        requestCount: p.request_count,
      })) ?? null,
    [shownPosts, t],
  );
  const ui = useRequestUI({ kind: "food", hue: "tangerine", userId, items: requestable, flows: requests });
  const reqItem = (p: FoodPost) => requestable?.find((r) => r.id === p.id);

  const grid = (items: FoodPost[], emptyTitle: string, empty: string) =>
    items.length === 0 ? (
      <EmptyState title={emptyTitle} hint={empty} hue="tangerine" />
    ) : (
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p, i) => (
          <li key={p.id} className="card anim-rise overflow-hidden" style={{ "--i": i } as CSSProperties} data-testid="food-card" data-item-id={p.id}>
            {/* Food card (design-system §6.3): the author pill floats on the photo, as on iOS and Android. */}
            <div className="relative">
              <Img src={p.image} alt={t("a11y.photoFrom", { name: p.user?.name ?? t("common.someone") })} className="h-[210px] w-full object-cover" />
              {reqItem(p) && (
                <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start gap-1">
                  {ui.badge(reqItem(p)!)}
                  {ui.pill(reqItem(p)!)}
                </div>
              )}
              <span className="absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-full bg-card/95 py-1 pl-1 pr-3 text-sm shadow-soft backdrop-blur-md">
                <Avatar name={p.user?.name} id={p.user_id} src={p.user?.avatar} size={24} decorative />
                <span className="truncate font-display font-bold">{p.user?.name ?? t("common.someone")}</span>
                <span className="shrink-0 text-xs text-muted">{fmt.relative(p.created_at)}</span>
              </span>
            </div>
            <div className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                {p.description ? <p className="min-w-0 flex-1 font-medium">{p.description}</p> : <span className="flex-1" />}
                {p.user_id !== userId && <SafetyMenu type="food_post" id={p.id} author={{ id: p.user_id, name: p.user?.name }} />}
                {p.user_id === userId && (
                  <span className="flex gap-1">
                    <button type="button" aria-label={t("food.editPost")} data-testid="edit-post" onClick={() => setEditing(p)} className="press-round h-9 w-9 rounded-full text-muted hover:bg-field hover:text-brand-ink">
                      <Pencil size={16} className="mx-auto" />
                    </button>
                    <button type="button" aria-label={t("food.deletePost")} data-testid="delete-post" onClick={() => remove(p)} className="press-round h-9 w-9 rounded-full text-muted hover:bg-danger/10 hover:text-danger-ink">
                      <Trash2 size={16} className="mx-auto" />
                    </button>
                  </span>
                )}
              </div>
              <FoodExpiryLabel expiresAt={p.expires_at} now={now} />
              {reqItem(p) && <div className="flex flex-col">{ui.actions(reqItem(p)!)}</div>}
              <ReactionBar state={reactions} targetId={p.id} className="hue-tangerine" />
            </div>
          </li>
        ))}
      </ul>
    );

  const shareButton = (
    <button type="button" className="btn-primary hue-tangerine min-h-10 px-4" data-testid="share-food" onClick={() => setEditing("new")}>
      <Plus size={18} strokeWidth={3} /> {t("food.share")}
    </button>
  );

  return (
    <div>
      <ErrorText>{error}</ErrorText>
      <StaleNotice show={sync.failed} onRetry={sync.retry} />
      {/* Same layout as Events: the add button sits on the first section header, sections carry a counter. */}
      {posts === null ? (
        <>
          <SectionTitle hue="tangerine" action={shareButton}>{t("food.myPosts")}</SectionTitle>
          {sync.failed ? <LoadError onRetry={sync.retry} /> : <PageLoader />}
        </>
      ) : shownPosts?.length === 0 ? (
        <>
          <SectionTitle hue="tangerine" action={shareButton}>{t("food.myPosts")}</SectionTitle>
          <EmptyState title={t("food.emptyTitle")} hint={t("food.emptyHint")} hue="tangerine" />
        </>
      ) : (
        <>
          <SectionTitle hue="tangerine" count={mine.length} action={shareButton}>{t("food.myPosts")}</SectionTitle>
          {grid(mine, t("food.emptyMineTitle"), t("food.emptyMine"))}
          <SectionTitle hue="tangerine" count={others.length}>{t("food.fromBubble")}</SectionTitle>
          {grid(others, t("food.emptyOthersTitle"), t("food.emptyOthers"))}
        </>
      )}
      {ui.dialogs}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? t("food.share") : t("food.editPost")}>
        {editing !== null && (
          <FoodForm
            // A fresh form per post: a second "Share food" always opens empty.
            key={editing === "new" ? "new" : editing.id}
            post={editing === "new" ? null : editing}
            onDone={() => {
              // Your first post: the cheering mascot (design-system 8.4).
              if (editing === "new" && mine.length === 0) cheer(t("cheer.firstPost"), "tangerine");
              setEditing(null);
              void load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function FoodForm({ post, onDone }: { post: FoodPost | null; onDone: () => void }) {
  const { supabase, userId } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations();
  const errorText = useErrorText();
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState(post?.description ?? "");
  // "Good until": always sent on create, on edit only when changed (null = untouched).
  const [expiresAt, setExpiresAt] = useState<Date | null>(() => (post ? null : presetValue("tomorrow", new Date())));
  const [expiryOk, setExpiryOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!post && !file) return setError(t("errors.pickPhoto"));
    if (!expiryOk) return setError(t("errors.invalidExpiry"));
    setBusy(true);
    setError(null);
    try {
      const image = file ? await uploadImage(supabase, "food.images", userId, file) : post!.image;
      const fields = { image, description: description.trim() || null, ...(expiresAt ? { expires_at: expiresAt.toISOString() } : {}) };
      const { error } = post
        ? await supabase.from("food_posts").update(fields).eq("id", post.id)
        : await supabase.from("food_posts").insert({ ...fields, bubble_id: bubble.id, user_id: userId });
      if (error) throw error;
      if (post && file) await removeImage(supabase, "food.images", post.image);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ImagePicker value={post?.image} file={file} onFile={setFile} />
      <div>
        <label className="label" htmlFor="food-desc">
          {t("common.description")}
        </label>
        <textarea
          id="food-desc"
          className="input min-h-20"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("food.descriptionPlaceholder")}
        />
      </div>
      <GoodUntilField
        initial={post ? new Date(post.expires_at) : null}
        onChange={(d, ok) => {
          setExpiresAt(d);
          setExpiryOk(ok);
        }}
      />
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-primary hue-tangerine min-h-[54px] w-full text-[17px]" disabled={busy}>
        {busy ? t("common.saving") : post ? t("common.saveChanges") : t("food.post")}
      </button>
    </form>
  );
}
