"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { SafetyMenu } from "@/components/safety";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { Avatar, EmptyState, ErrorText, ImagePicker, Img, Modal, PageLoader, SectionTitle } from "@/components/ui";
import { AUTHOR, type FoodPost } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { removeImage, uploadImage } from "@/lib/utils";

export default function FoodPage() {
  const { supabase, userId, blocked } = useBoolaa();
  const t = useTranslations();
  const errorText = useErrorText();
  const fmt = useFormat();
  const bubble = useBubble();
  const [posts, setPosts] = useState<FoodPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FoodPost | "new" | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("food_posts")
      .select(`*, user:users!user_id(${AUTHOR})`)
      .eq("bubble_id", bubble.id)
      .order("created_at", { ascending: false });
    if (error) setError(errorText(error));
    setPosts(data ?? []);
  }, [supabase, bubble.id, errorText]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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
      <p className="card px-4 py-6 text-center text-sm text-muted">{empty}</p>
    ) : (
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <li key={p.id} className="card overflow-hidden" data-testid="food-card">
            <Img src={p.image} alt={p.description || t("food.imageAlt")} className="aspect-[4/3] w-full object-cover" />
            <div className="space-y-2 p-4">
              {p.description && <p className="text-[15px]">{p.description}</p>}
              <div className="flex items-center justify-between">
                <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
                  <Avatar name={p.user?.name} src={p.user?.avatar} size={24} />
                  <span className="truncate">
                    {p.user?.name ?? t("common.someone")} · {fmt.relative(p.created_at)}
                  </span>
                </span>
                {p.user_id !== userId && <SafetyMenu type="food_post" id={p.id} author={{ id: p.user_id, name: p.user?.name }} />}
                {p.user_id === userId && (
                  <span className="flex gap-1">
                    <button type="button" aria-label={t("food.editPost")} data-testid="edit-post" onClick={() => setEditing(p)} className="h-8 w-8 rounded-full text-muted hover:bg-chip hover:text-brand">
                      <Pencil size={16} className="mx-auto" />
                    </button>
                    <button type="button" aria-label={t("food.deletePost")} data-testid="delete-post" onClick={() => remove(p)} className="h-8 w-8 rounded-full text-muted hover:bg-chip hover:text-red-500">
                      <Trash2 size={16} className="mx-auto" />
                    </button>
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    );

  return (
    <div>
      <ErrorText>{error}</ErrorText>
      <div className="mb-4 flex justify-end">
        <button type="button" className="btn-primary" data-testid="share-food" onClick={() => setEditing("new")}>
          <Plus size={18} /> {t("food.share")}
        </button>
      </div>
      {posts === null ? (
        <PageLoader />
      ) : posts.length === 0 ? (
        <EmptyState icon={<UtensilsCrossed size={32} />} title={t("food.emptyTitle")} hint={t("food.emptyHint")} />
      ) : (
        <>
          <SectionTitle>{t("food.myPosts")}</SectionTitle>
          {grid(mine, t("food.emptyMine"))}
          <SectionTitle>{t("food.fromBubble")}</SectionTitle>
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
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? t("common.saving") : post ? t("common.saveChanges") : t("food.post")}
      </button>
    </form>
  );
}
