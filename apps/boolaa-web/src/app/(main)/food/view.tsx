"use client";

import { useCallback, useState, type CSSProperties, type FormEvent } from "react";
import { Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { SafetyMenu } from "@/components/safety";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { byCreatedDesc, useLiveFeed } from "@/lib/live-feed";
import { Avatar, EmptyState, ErrorText, ImagePicker, Img, Modal, PageLoader, SectionTitle, EmptyNote } from "@/components/ui";
import { LoadError, StaleNotice, useCachedState, useResilientLoad } from "@/components/offline";
import { AUTHOR, type FoodPost } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { removeImage, uploadImage } from "@/lib/utils";
import { useReactions } from "@/lib/reactions";
import { ReactionBar } from "@/components/reactions";

export default function FoodPage() {
  const { supabase, userId, blocked } = useBoolaa();
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

  // Other members' changes stream in (Realtime, filtered by bubble, RLS-checked).
  const reactions = useReactions({ supabase, bubbleId: bubble.id, type: "food_post", targetIds: posts?.map((p) => p.id) ?? [], userId, onError: (e) => setError(errorText(e)) });
  useLiveFeed<FoodPost>({
    supabase,
    table: "food_posts",
    bubbleId: bubble.id,
    select: `*, user:users!user_id(${AUTHOR})`,
    rows: posts,
    setRows: setPosts,
    compare: byCreatedDesc,
    reload: () => Promise.all([load(), reactions.reload()]),
    extend: reactions.bind,
  });

  async function remove(p: FoodPost) {
    if (!window.confirm(t("food.confirmDelete"))) return;
    const { error } = await supabase.from("food_posts").delete().eq("id", p.id);
    if (error) return setError(errorText(error));
    await removeImage(supabase, "food.images", p.image);
    void load();
  }

  const mine = posts?.filter((p) => p.user_id === userId) ?? [];
  const others = posts?.filter((p) => p.user_id !== userId && !blocked.has(p.user_id)) ?? [];

  const grid = (items: FoodPost[], empty: string) =>
    items.length === 0 ? (
      <EmptyNote hue="tangerine">{empty}</EmptyNote>
    ) : (
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p, i) => (
          <li key={p.id} className="card anim-rise overflow-hidden" style={{ "--i": i } as CSSProperties} data-testid="food-card" data-item-id={p.id}>
            <Img src={p.image} alt={p.description || t("food.imageAlt")} className="h-[210px] w-full object-cover" />
            <div className="space-y-2 p-4">
              {p.description && <p className="text-[15px]">{p.description}</p>}
              <div className="flex items-center justify-between">
                <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
                  <Avatar name={p.user?.name} id={p.user_id} src={p.user?.avatar} size={24} />
                  <span className="truncate">
                    {p.user?.name ?? t("common.someone")} · {fmt.relative(p.created_at)}
                  </span>
                </span>
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
              <ReactionBar state={reactions} targetId={p.id} className="hue-tangerine" />
            </div>
          </li>
        ))}
      </ul>
    );

  return (
    <div>
      <ErrorText>{error}</ErrorText>
      <StaleNotice show={sync.failed} onRetry={sync.retry} />
      <div className="mb-4 flex justify-end">
        <button type="button" className="btn-primary hue-tangerine min-h-10 px-4" data-testid="share-food" onClick={() => setEditing("new")}>
          <Plus size={18} strokeWidth={3} /> {t("food.share")}
        </button>
      </div>
      {posts === null ? (
        sync.failed ? (
          <LoadError onRetry={sync.retry} />
        ) : (
          <PageLoader />
        )
      ) : posts.length === 0 ? (
        <EmptyState icon={<UtensilsCrossed size={30} strokeWidth={2.4} />} title={t("food.emptyTitle")} hint={t("food.emptyHint")} hue="tangerine" />
      ) : (
        <>
          <SectionTitle hue="tangerine">{t("food.myPosts")}</SectionTitle>
          {grid(mine, t("food.emptyMine"))}
          <SectionTitle hue="tangerine">{t("food.fromBubble")}</SectionTitle>
          {grid(others, t("food.emptyOthers"))}
        </>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? t("food.share") : t("food.editPost")}>
        {editing !== null && (
          <FoodForm
            post={editing === "new" ? null : editing}
            onDone={() => {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!post && !file) return setError(t("errors.pickPhoto"));
    setBusy(true);
    setError(null);
    try {
      const image = file ? await uploadImage(supabase, "food.images", userId, file) : post!.image;
      const fields = { image, description: description.trim() || null };
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
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-primary hue-tangerine w-full" disabled={busy}>
        {busy ? t("common.saving") : post ? t("common.saveChanges") : t("food.post")}
      </button>
    </form>
  );
}
