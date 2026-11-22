"use client";

import { useReactions, type Reactions } from "@/lib/reactions";
import { ReactionBar } from "@/components/reactions";
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { CalendarPlus, CircleCheck, CirclePlus, Clock, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { Confetti } from "@/components/confetti";
import { SafetyMenu } from "@/components/safety";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { byDatetimeAsc, useLiveFeed } from "@/lib/live-feed";
import { Avatar, EmptyState, ErrorText, Modal, PageLoader, SectionTitle } from "@/components/ui";
import { AUTHOR, type BoolaaEvent } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { cx, toLocalInput } from "@/lib/utils";
import { downloadIcs } from "@/lib/ics";

export default function EventsPage() {
  const { supabase, userId, blocked } = useBoolaa();
  const t = useTranslations("events");
  const errorText = useErrorText();
  const bubble = useBubble();
  const [events, setEvents] = useState<BoolaaEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BoolaaEvent | "new" | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("events")
      .select(`*, creator:users!creator_id(${AUTHOR})`)
      .eq("bubble_id", bubble.id)
      .order("datetime", { ascending: true });
    if (error) setError(errorText(error));
    setNow(Date.now());
    setEvents(data ?? []);
  }, [supabase, bubble.id, errorText]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Other members' changes stream in (Realtime, filtered by bubble, RLS-checked).
  const reactions = useReactions({ supabase, bubbleId: bubble.id, type: "event", targetIds: events?.map((e) => e.id) ?? [], userId, onError: (e) => setError(errorText(e)) });
  useLiveFeed<BoolaaEvent>({
    supabase,
    table: "events",
    bubbleId: bubble.id,
    select: `*, creator:users!creator_id(${AUTHOR})`,
    rows: events,
    setRows: setEvents,
    compare: byDatetimeAsc,
    reload: () => Promise.all([load(), reactions.reload()]),
    extend: reactions.bind,
  });

  /** Returns whether the user is going once the server has confirmed. */
  async function toggleRsvp(ev: BoolaaEvent): Promise<boolean | null> {
    const { data, error } = await supabase.rpc("toggle_rsvp", { p_event_id: ev.id });
    if (error) {
      setError(errorText(error));
      return null;
    }
    setEvents((prev) => prev?.map((e) => (e.id === ev.id ? { ...e, rsvp_list: data ?? [] } : e)) ?? null);
    return (data ?? []).includes(userId);
  }

  async function remove(ev: BoolaaEvent) {
    if (!window.confirm(t("confirmDelete", { title: ev.title }))) return;
    const { error } = await supabase.from("events").delete().eq("id", ev.id);
    if (error) return setError(errorText(error));
    void load();
  }

  const mine = events?.filter((e) => e.creator_id === userId) ?? [];
  const others = events?.filter((e) => e.creator_id !== userId && !blocked.has(e.creator_id)) ?? [];

  const list = (items: BoolaaEvent[], empty: string) =>
    items.length === 0 ? (
      <EmptyState icon={<CalendarPlus size={30} strokeWidth={2.4} />} title={t("emptyTitle")} hint={empty} hue="coral" />
    ) : (
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((ev, i) => (
          <EventCard
            key={ev.id}
            index={i}
            ev={ev}
            now={now}
            mine={ev.creator_id === userId}
            going={ev.rsvp_list.includes(userId)}
            onRsvp={() => toggleRsvp(ev)}
            onEdit={() => setEditing(ev)}
            onDelete={() => remove(ev)}
            reactions={reactions}
          />
        ))}
      </ul>
    );

  const newButton = (
    <button type="button" className="btn-primary hue-coral min-h-10 px-4" data-testid="new-event" onClick={() => setEditing("new")}>
      <Plus size={18} strokeWidth={3} /> {t("newEvent")}
    </button>
  );

  return (
    <div>
      <ErrorText>{error}</ErrorText>
      {events === null ? (
        <>
          <SectionTitle hue="coral" action={newButton}>{t("myEvents")}</SectionTitle>
          <PageLoader />
        </>
      ) : events.length === 0 ? (
        <>
          <SectionTitle hue="coral" action={newButton}>{t("myEvents")}</SectionTitle>
          <EmptyState icon={<CalendarPlus size={30} strokeWidth={2.4} />} title={t("emptyTitle")} hint={t("emptyHint")} hue="coral" />
        </>
      ) : (
        <>
          <SectionTitle hue="coral" count={mine.length} action={newButton}>{t("myEvents")}</SectionTitle>
          {list(mine, t("emptyMine"))}
          <SectionTitle hue="coral" count={others.length}>{t("bubbleEvents")}</SectionTitle>
          {list(others, t("emptyOthers"))}
        </>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? t("newEvent") : t("editEvent")}>
        {editing !== null && (
          <EventForm
            event={editing === "new" ? null : editing}
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

function EventCard({
  ev,
  index,
  now,
  mine,
  going,
  onRsvp,
  onEdit,
  onDelete,
  reactions,
}: {
  ev: BoolaaEvent;
  index: number;
  now: number;
  mine: boolean;
  going: boolean;
  onRsvp: () => Promise<boolean | null>;
  onEdit: () => void;
  onDelete: () => void;
  reactions: Reactions;
}) {
  const t = useTranslations("events");
  const tc = useTranslations("common");
  const fmt = useFormat();
  const past = new Date(ev.datetime).getTime() < now;
  const [burst, setBurst] = useState(0);
  return (
    <li className={cx("card anim-rise flex flex-col gap-3 p-4", past && "opacity-60")} style={{ "--i": index } as CSSProperties} data-testid="event-card" data-item-id={ev.id}>
      <div className="flex gap-3.5">
        {/* Date tile, tilted (6.3) */}
        <div className="hue-coral flex h-16 w-14 shrink-0 -rotate-4 flex-col overflow-hidden rounded-field bg-hue-wash shadow-soft">
          <span className="bg-hue-grad py-0.5 text-center font-display text-[11px] font-black uppercase text-onfill">{fmt.month(ev.datetime)}</span>
          <span className="flex flex-1 items-center justify-center font-display text-[22px] font-black leading-none text-hue-ink">{fmt.day(ev.datetime)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-extrabold">{ev.title}</h3>
          <p className="flex items-center gap-1.5 text-[15px] text-muted">
            <Clock size={14} strokeWidth={2.6} className="shrink-0" /> {fmt.dateTime(ev.datetime)}
          </p>
          {ev.location && (
            <p className="flex items-center gap-1.5 text-[15px] text-muted">
              <MapPin size={14} strokeWidth={2.6} className="shrink-0" /> {ev.location}
            </p>
          )}
        </div>
        {!mine && <SafetyMenu type="event" id={ev.id} author={{ id: ev.creator_id, name: ev.creator?.name }} />}
        {mine && (
          <div className="flex gap-1">
            <button type="button" aria-label={t("editEvent")} onClick={onEdit} className="press-round h-9 w-9 rounded-full text-muted hover:bg-field hover:text-brand-ink">
              <Pencil size={16} className="mx-auto" />
            </button>
            <button type="button" aria-label={t("deleteEvent")} onClick={onDelete} className="press-round h-9 w-9 rounded-full text-muted hover:bg-danger/10 hover:text-danger-ink">
              <Trash2 size={16} className="mx-auto" />
            </button>
          </div>
        )}
      </div>
      {ev.description && <p className="text-[15px]">{ev.description}</p>}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
          <Avatar name={ev.creator?.name} id={ev.creator_id} src={ev.creator?.avatar} size={24} />
          <span className="truncate">{ev.creator?.name ?? tc("someone")}</span>
        </span>
        <span className="ml-auto flex items-center gap-3">
          <button
            type="button"
            aria-label={t("addToCalendar")}
            title={t("addToCalendar")}
            data-testid="add-to-calendar"
            onClick={() => downloadIcs({ id: ev.id, title: ev.title, start: ev.datetime, description: ev.description, location: ev.location })}
            className="press-round hue-coral h-9 w-9 rounded-full text-muted hover:bg-hue-wash hover:text-hue-ink"
          >
            <CalendarPlus size={17} strokeWidth={2.4} className="mx-auto" />
          </button>
          <span key={ev.rsvp_list.length} className="anim-fade text-sm tabular-nums text-muted" data-testid="rsvp-count" data-count={ev.rsvp_list.length}>
            {t("goingCount", { count: ev.rsvp_list.length })}
          </span>
          <button
            type="button"
            onClick={async () => {
              if ((await onRsvp()) === true) setBurst((n) => n + 1);
            }}
            aria-pressed={going}
            data-testid="rsvp-button"
            className={cx(
              "chip relative transition-[background,color,box-shadow,transform] duration-300",
              going ? "hue-mint fill-hue" : "hue-coral bg-hue-wash text-hue-ink hover:brightness-105",
            )}
          >
            {burst > 0 && <Confetti key={burst} />}
            <span key={going ? "on" : "off"} className="anim-pop inline-flex">
              {going ? <CircleCheck size={18} strokeWidth={2.6} /> : <CirclePlus size={18} strokeWidth={2.6} />}
            </span>
            {going ? t("going") : t("rsvp")}
          </button>
        </span>
      </div>
      <ReactionBar state={reactions} targetId={ev.id} className="hue-coral" />
    </li>
  );
}

function EventForm({ event, onDone }: { event: BoolaaEvent | null; onDone: () => void }) {
  const { supabase, userId } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations();
  const errorText = useErrorText();
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [when, setWhen] = useState(() =>
    toLocalInput(event?.datetime ?? new Date(Date.now() + 86400000).toISOString().slice(0, 13) + ":00:00Z"),
  );
  const [location, setLocation] = useState(event?.location ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fields = {
      title: title.trim(),
      description: description.trim() || null,
      datetime: new Date(when).toISOString(),
      location: location.trim() || null,
    };
    const { error } = event
      ? await supabase.from("events").update(fields).eq("id", event.id)
      : await supabase.from("events").insert({ ...fields, bubble_id: bubble.id, creator_id: userId });
    setBusy(false);
    if (error) return setError(errorText(error));
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="ev-title">
          {t("common.title")}
        </label>
        <input id="ev-title" className="input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="ev-when">
          {t("events.dateTime")}
        </label>
        <input id="ev-when" type="datetime-local" className="input" required value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="ev-location">
          {t("events.location")}
        </label>
        <input id="ev-location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="ev-desc">
          {t("common.description")}
        </label>
        <textarea id="ev-desc" className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-primary hue-coral w-full" disabled={busy || !title.trim() || !when}>
        {busy ? t("common.saving") : event ? t("common.saveChanges") : t("events.create")}
      </button>
    </form>
  );
}
