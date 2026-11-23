"use client";

import { useReactions } from "@/lib/reactions";
import { ReactionBar } from "@/components/reactions";
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleSlash, EyeOff, Hourglass, MessageCircle, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { SafetyMenu } from "@/components/safety";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { byCreatedDesc, useLiveFeed } from "@/lib/live-feed";
import { Avatar, EmptyState, ErrorText, ImagePicker, Img, Modal, PageLoader, StatusBadge } from "@/components/ui";
import { AUTHOR, type MarketItem } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { cx, removeImage, uploadImage } from "@/lib/utils";
import { AVAILABILITIES, availabilityOf, canAskOwner, visibleItems, type Availability } from "@/lib/market";
import { setChatDraft } from "@/lib/chat-draft";

type Status = "free" | "trade";
const FILTERS = ["all", "free", "trade"] as const;

export default function MarketplacePage() {
  const { supabase, userId, blocked } = useBoolaa();
  const t = useTranslations();
  const errorText = useErrorText();
  const bubble = useBubble();
  const [items, setItems] = useState<MarketItem[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [hideTaken, setHideTaken] = useState(false);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MarketItem | "new" | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("market_items")
      .select(`*, owner:users!owner_id(${AUTHOR})`)
      .eq("bubble_id", bubble.id)
      .order("created_at", { ascending: false });
    if (error) setError(errorText(error));
    setItems(data ?? []);
  }, [supabase, bubble.id, errorText]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Other members' changes stream in (Realtime, filtered by bubble, RLS-checked).
  const reactions = useReactions({ supabase, bubbleId: bubble.id, type: "market_item", targetIds: items?.map((i) => i.id) ?? [], userId, onError: (e) => setError(errorText(e)) });
  useLiveFeed<MarketItem>({
    supabase,
    table: "market_items",
    bubbleId: bubble.id,
    select: `*, owner:users!owner_id(${AUTHOR})`,
    rows: items,
    setRows: setItems,
    compare: byCreatedDesc,
    reload: () => Promise.all([load(), reactions.reload()]),
    extend: reactions.bind,
  });

  async function remove(item: MarketItem) {
    if (!window.confirm(t("market.confirmDelete", { title: item.title }))) return;
    const { error } = await supabase.from("market_items").delete().eq("id", item.id);
    if (error) return setError(errorText(error));
    await removeImage(supabase, "market.images", item.image);
    void load();
  }

  /** Owner only (RLS: market_update_own). Shown at once; others get the UPDATE live. */
  async function setAvailability(item: MarketItem, availability: Availability) {
    setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, availability } : i)) ?? null);
    const { error } = await supabase.from("market_items").update({ availability }).eq("id", item.id);
    if (error) {
      setError(errorText(error));
      void load();
    }
  }

  /** Opens the bubble chat with an unsent message to the owner (the app has group chat, no DMs). */
  function askOwner(item: MarketItem) {
    setChatDraft(bubble.id, t("market.askDraft", { name: item.owner?.name ?? t("common.someone"), title: item.title }));
    router.push("/chat");
  }

  const shown = items ? visibleItems(items, { filter, hideTaken, blocked }) : [];

  return (
    <div>
      <ErrorText>{error}</ErrorText>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("market.filter")}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              data-testid={`filter-${f}`}
              onClick={() => setFilter(f)}
              className={cx("chip hue-mint transition-[background,color,box-shadow,transform]", filter === f ? "fill-hue" : "bg-field text-muted hover:text-fg")}
            >
              {t(`market.${f}`)}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={hideTaken}
            data-testid="filter-hide-taken"
            onClick={() => setHideTaken((v) => !v)}
            className={cx("chip hue-mint transition-[background,color,box-shadow,transform]", hideTaken ? "fill-hue" : "bg-field text-muted hover:text-fg")}
          >
            <EyeOff size={15} strokeWidth={2.6} /> {t("market.hideTaken")}
          </button>
        </div>
        <button type="button" className="btn-primary hue-mint min-h-10 px-4" data-testid="add-item" onClick={() => setEditing("new")}>
          <Plus size={18} strokeWidth={3} /> {t("market.addItem")}
        </button>
      </div>
      {items === null ? (
        <PageLoader />
      ) : shown.length === 0 ? (
        <EmptyState icon={<Tags size={30} strokeWidth={2.4} />} title={t("market.emptyTitle")} hint={t("market.emptyHint")} hue="mint" />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {shown.map((item, i) => (
            <li key={item.id} className="card anim-rise flex min-w-0 flex-col overflow-hidden" style={{ "--i": i } as CSSProperties} data-testid="market-item" data-item-id={item.id} data-availability={availabilityOf(item)}>
              <div className="relative">
                <Img src={item.image} alt={item.title} className={cx("aspect-square w-full object-cover transition-[filter,opacity] duration-300", availabilityOf(item) === "taken" && "opacity-55 grayscale")} />
                {/* One row that wraps, so the two badges never overlap on a narrow card. */}
                <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start gap-1">
                  <StatusBadge status={item.status} />
                  <AvailabilityBadge availability={availabilityOf(item)} className="ml-auto" />
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <h3 className="truncate text-[15px] font-extrabold">{item.title}</h3>
                {item.description && <p className="line-clamp-2 text-sm text-muted">{item.description}</p>}
                {item.owner_id === userId && (
                  <label className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-muted">
                    <span className="shrink-0">{t("market.markAs")}</span>
                    <select
                      className="hue-mint min-h-8 min-w-[7.5rem] flex-1 rounded-full bg-field px-2 text-[13px] font-bold text-fg outline-none focus:ring-2 focus:ring-[var(--h)]"
                      value={availabilityOf(item)}
                      data-testid="availability-select"
                      onChange={(e) => setAvailability(item, e.target.value as Availability)}
                    >
                      {AVAILABILITIES.map((a) => (
                        <option key={a} value={a}>
                          {t(`market.${a}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {canAskOwner(item, userId) && (
                  <button type="button" data-testid="ask-owner" onClick={() => askOwner(item)} className="chip hue-grape mt-1 h-auto min-h-[38px] max-w-full self-start whitespace-normal bg-hue-wash py-1.5 text-left leading-tight text-hue-ink hover:brightness-105">
                    <MessageCircle size={15} strokeWidth={2.6} className="shrink-0" /> {t("market.askInChat")}
                  </button>
                )}
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                    <Avatar name={item.owner?.name} id={item.owner_id} src={item.owner?.avatar} size={22} decorative />
                    <span className="truncate">{item.owner?.name ?? t("common.someone")}</span>
                  </span>
                  {item.owner_id !== userId && <SafetyMenu type="market_item" id={item.id} author={{ id: item.owner_id, name: item.owner?.name }} />}
                  {item.owner_id === userId && (
                    <span className="flex">
                      <button type="button" aria-label={t("market.editItem")} data-testid="edit-item" onClick={() => setEditing(item)} className="press-round h-9 w-9 rounded-full text-muted hover:bg-field hover:text-brand-ink">
                        <Pencil size={15} className="mx-auto" />
                      </button>
                      <button type="button" aria-label={t("market.deleteItem")} data-testid="delete-item" onClick={() => remove(item)} className="press-round h-9 w-9 rounded-full text-muted hover:bg-danger/10 hover:text-danger-ink">
                        <Trash2 size={15} className="mx-auto" />
                      </button>
                    </span>
                  )}
                </div>
                <ReactionBar state={reactions} targetId={item.id} className="hue-mint pt-1" />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? t("market.addItem") : t("market.editItem")}>
        {editing !== null && (
          <ItemForm
            item={editing === "new" ? null : editing}
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

function ItemForm({ item, onDone }: { item: MarketItem | null; onDone: () => void }) {
  const { supabase, userId } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations();
  const errorText = useErrorText();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [status, setStatus] = useState<Status>((item?.status as Status) ?? "free");
  const [availability, setAvailability] = useState<Availability>(item ? availabilityOf(item) : "available");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!item && !file) return setError(t("errors.pickPhoto"));
    setBusy(true);
    setError(null);
    try {
      const image = file ? await uploadImage(supabase, "market.images", userId, file) : item!.image;
      const fields = { image, title: title.trim(), description: description.trim() || null, status, availability };
      const { error } = item
        ? await supabase.from("market_items").update(fields).eq("id", item.id)
        : await supabase.from("market_items").insert({ ...fields, bubble_id: bubble.id, owner_id: userId });
      if (error) throw error;
      if (item && file) await removeImage(supabase, "market.images", item.image);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ImagePicker value={item?.image} file={file} onFile={setFile} />
      <div>
        <label className="label" htmlFor="item-title">
          {t("common.title")}
        </label>
        <input id="item-title" className="input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="item-desc">
          {t("common.description")}
        </label>
        <textarea id="item-desc" className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <span className="label">{t("market.status")}</span>
        <div className="grid grid-cols-2 rounded-full bg-field p-1">
          {(["free", "trade"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              data-testid={`status-${s}`}
              onClick={() => setStatus(s)}
              className={cx("hue-mint min-h-10 rounded-full px-2 text-[15px] font-bold transition-[background,color,box-shadow] duration-300", status === s ? "fill-hue" : "text-muted hover:text-fg")}
            >
              {t(`market.${s}`)}
            </button>
          ))}
        </div>
      </div>
      {item && (
        <div>
          <span className="label">{t("market.availability")}</span>
          <div className="grid grid-cols-3 rounded-full bg-field p-1">
            {AVAILABILITIES.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={availability === a}
                data-testid={`availability-${a}`}
                onClick={() => setAvailability(a)}
                className={cx("hue-mint min-h-10 rounded-full px-2 text-[15px] font-bold transition-[background,color,box-shadow] duration-300", availability === a ? "fill-hue" : "text-muted hover:text-fg")}
              >
                {t(`market.${a}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-primary hue-mint w-full" disabled={busy || !title.trim()}>
        {busy ? t("common.saving") : item ? t("common.saveChanges") : t("market.addItem")}
      </button>
    </form>
  );
}

/** Shown only when an item is no longer simply available. */
function AvailabilityBadge({ availability, className }: { availability: Availability; className?: string }) {
  const t = useTranslations("market");
  if (availability === "available") return null;
  const reserved = availability === "reserved";
  return (
    <span
      data-testid="availability-badge"
      data-availability={availability}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-display text-xs font-black uppercase tracking-wide shadow-glow",
        reserved ? "hue-tangerine bg-hue-grad text-onfill" : "bg-black/70 text-white",
        className,
      )}
    >
      {reserved ? <Hourglass size={13} strokeWidth={2.6} /> : <CircleSlash size={13} strokeWidth={2.6} />}
      {t(availability)}
    </span>
  );
}
