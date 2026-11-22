"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { ExternalLink, Link2, Plus, Trash2 } from "lucide-react";
import { SafetyMenu } from "@/components/safety";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { byCreatedDesc, useLiveFeed } from "@/lib/live-feed";
import { Avatar, EmptyState, ErrorText, Modal, PageLoader } from "@/components/ui";
import { AUTHOR, type SharedLink } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { cx } from "@/lib/utils";
import { useReactions } from "@/lib/reactions";
import { ReactionBar } from "@/components/reactions";
import type { BoolaaClient } from "@/lib/supabase/client";

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function LinksPage() {
  const { supabase, userId, blocked } = useBoolaa();
  const t = useTranslations("links");
  const errorText = useErrorText();
  const fmt = useFormat();
  const bubble = useBubble();
  const [links, setLinks] = useState<SharedLink[] | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("shared_links")
      .select(`*, user:users!user_id(${AUTHOR})`)
      .eq("bubble_id", bubble.id)
      .order("created_at", { ascending: false });
    if (error) setError(errorText(error));
    setLinks(data ?? []);
  }, [supabase, bubble.id, errorText]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Other members' changes stream in (Realtime, filtered by bubble, RLS-checked).
  // The server fills in the preview later; it arrives as an UPDATE of the row (merged with all its columns).
  const reactions = useReactions({ supabase, bubbleId: bubble.id, type: "shared_link", targetIds: links?.map((l) => l.id) ?? [], userId, onError: (e) => setError(errorText(e)) });
  useLiveFeed<SharedLink>({
    supabase,
    table: "shared_links",
    bubbleId: bubble.id,
    select: `*, user:users!user_id(${AUTHOR})`,
    rows: links,
    setRows: setLinks,
    compare: byCreatedDesc,
    reload: () => Promise.all([load(), reactions.reload()]),
    extend: reactions.bind,
  });

  const tags = useMemo(() => [...new Set((links ?? []).flatMap((l) => l.tags))].sort(), [links]);
  const shown = (links ?? []).filter((l) => (!tag || l.tags.includes(tag)) && !blocked.has(l.user_id));

  async function remove(link: SharedLink) {
    if (!window.confirm(t("confirmDelete", { title: link.title || link.url }))) return;
    const { error } = await supabase.from("shared_links").delete().eq("id", link.id);
    if (error) return setError(errorText(error));
    void load();
  }

  return (
    <div>
      <ErrorText>{error}</ErrorText>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="scrollbar-none flex gap-2 overflow-x-auto" role="group" aria-label={t("filter")} data-testid="tag-filter">
          <button
            type="button"
            aria-pressed={tag === null}
            onClick={() => setTag(null)}
            className={cx("chip hue-sky transition-[background,color,box-shadow,transform]", tag === null ? "fill-hue" : "bg-field text-muted hover:text-fg")}
          >
            {t("all")}
          </button>
          {tags.map((tg) => (
            <button
              key={tg}
              type="button"
              aria-pressed={tag === tg}
              data-testid={`tag-${tg}`}
              onClick={() => setTag(tag === tg ? null : tg)}
              className={cx("chip hue-sky transition-[background,color,box-shadow,transform]", tag === tg ? "fill-hue" : "bg-field text-muted hover:text-fg")}
            >
              #{tg}
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary hue-sky min-h-10 shrink-0 px-4" data-testid="add-link" onClick={() => setAdding(true)}>
          <Plus size={18} strokeWidth={3} /> {t("addLink")}
        </button>
      </div>
      {links === null ? (
        <PageLoader />
      ) : shown.length === 0 ? (
        <EmptyState icon={<Link2 size={30} strokeWidth={2.4} />} title={t("emptyTitle")} hint={t("emptyHint")} hue="sky" />
      ) : (
        <ul className="space-y-3">
          {shown.map((l, i) => (
            <li key={l.id} className="card anim-rise flex flex-col gap-3 p-4" style={{ "--i": i } as CSSProperties} data-testid="link-card" data-item-id={l.id} data-preview={l.preview_status}>
              <div className="flex items-center gap-3">
              <span className="hue-sky flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-hue-grad text-onfill shadow-glow">
                <Link2 size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold hover:text-brand-ink">
                  {l.title || hostOf(l.url)}
                </a>
                <p className="truncate text-sm text-muted">{hostOf(l.url)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {l.tags.map((tg) => (
                    <button key={tg} type="button" onClick={() => setTag(tg)} className="hue-sky press rounded-full bg-hue-wash px-2 py-0.5 font-display text-xs font-bold text-hue-ink">
                      #{tg}
                    </button>
                  ))}
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Avatar name={l.user?.name} id={l.user_id} src={l.user?.avatar} size={20} /> {l.user?.name} · {fmt.relative(l.created_at)}
                  </span>
                </div>
              </div>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("openLink")}
                className="hue-sky press-round flex h-[38px] w-[38px] items-center justify-center rounded-full bg-hue-wash text-hue-ink"
              >
                <ExternalLink size={18} />
              </a>
              {l.user_id !== userId && <SafetyMenu type="shared_link" id={l.id} author={{ id: l.user_id, name: l.user?.name }} />}
              {l.user_id === userId && (
                <button type="button" aria-label={t("deleteLink")} onClick={() => remove(l)} className="press-round flex h-[38px] w-[38px] items-center justify-center rounded-full bg-danger/10 text-danger-ink">
                  <Trash2 size={17} />
                </button>
              )}
              </div>
              <LinkPreview supabase={supabase} link={l} />
              <ReactionBar state={reactions} targetId={l.id} className="hue-sky" />
            </li>
          ))}
        </ul>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title={t("addLink")}>
        {adding && (
          <LinkForm
            onDone={() => {
              setAdding(false);
              void load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/**
 * Open Graph card fetched and stored by the server (docs/boolaa-spec.md, "Link previews"). The image
 * is our own re-encoded copy in Storage, never the third-party host, so opening the list leaks nothing.
 */
function LinkPreview({ supabase, link }: { supabase: BoolaaClient; link: SharedLink }) {
  const t = useTranslations("links");
  if (link.preview_status === "pending" || link.preview_status === "fetching") {
    return (
      <p className="text-xs text-muted" data-testid="link-preview-loading">
        {t("previewLoading")}
      </p>
    );
  }
  if (link.preview_status !== "ready" || !(link.preview_title || link.preview_description || link.preview_image_path)) return null;
  const image = link.preview_image_path ? supabase.storage.from("link.previews").getPublicUrl(link.preview_image_path).data.publicUrl : null;
  const host = hostOf(link.url);
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="link-preview"
      className="hue-sky lift block overflow-hidden rounded-field border border-line bg-field/60 hover:border-[var(--h)]"
    >
      {image && (
        /* eslint-disable-next-line @next/next/no-img-element -- public Storage URL of our own copy */
        <img src={image} alt="" loading="lazy" data-testid="link-preview-image" className="aspect-[1.91/1] w-full object-cover" />
      )}
      <div className="space-y-0.5 p-3">
        {link.preview_title && <p className="line-clamp-2 font-bold" data-testid="link-preview-title">{link.preview_title}</p>}
        {link.preview_description && <p className="line-clamp-2 text-sm text-muted">{link.preview_description}</p>}
        <p className="truncate text-xs font-bold text-hue-ink" data-testid="link-preview-domain">
          {host}
          {link.preview_site_name && link.preview_site_name.toLowerCase() !== host.toLowerCase() ? ` · ${link.preview_site_name}` : ""}
        </p>
      </div>
    </a>
  );
}

function LinkForm({ onDone }: { onDone: () => void }) {
  const { supabase, userId } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations();
  const errorText = useErrorText();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    let href = url.trim();
    if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("shared_links").insert({
      bubble_id: bubble.id,
      user_id: userId,
      url: href,
      title: title.trim() || null,
      tags: [...new Set(tags.split(",").map((s) => s.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))],
    });
    setBusy(false);
    if (error) return setError(errorText(error));
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="link-url">
          {t("links.url")}
        </label>
        <input id="link-url" className="input" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
      </div>
      <div>
        <label className="label" htmlFor="link-title">
          {t("common.title")}
        </label>
        <input id="link-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="link-tags">
          {t("links.tags")}
        </label>
        <input id="link-tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("links.tagsPlaceholder")} />
      </div>
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-primary hue-sky w-full" disabled={busy || !url.trim()}>
        {busy ? t("common.saving") : t("links.addLink")}
      </button>
    </form>
  );
}
