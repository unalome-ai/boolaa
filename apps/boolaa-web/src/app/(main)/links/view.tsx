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
  useLiveFeed<SharedLink>({ supabase, table: "shared_links", bubbleId: bubble.id, select: `*, user:users!user_id(${AUTHOR})`, rows: links, setRows: setLinks, compare: byCreatedDesc, reload: load });

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
            <li key={l.id} className="card anim-rise flex items-center gap-3 p-4" style={{ "--i": i } as CSSProperties} data-testid="link-card">
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
