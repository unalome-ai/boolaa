"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Check, MapPin, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { Avatar, EmptyState, ErrorText, Modal, PageLoader, SectionTitle } from "@/components/ui";
import { AUTHOR, type BoolaaEvent } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { cx, toLocalInput } from "@/lib/utils";

export default function EventsPage() {
  const { supabase, userId } = useBoolaa();
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

  async function toggleRsvp(ev: BoolaaEvent) {
    const { data, error } = await supabase.rpc("toggle_rsvp", { p_event_id: ev.id });
    if (error) return setError(errorText(error));
    setEvents((prev) => prev?.map((e) => (e.id === ev.id ? { ...e, rsvp_list: data ?? [] } : e)) ?? null);
  }

  async function remove(ev: BoolaaEvent) {
    if (!window.confirm(t("confirmDelete", { title: ev.title }))) return;
    const { error } = await supabase.from("events").delete().eq("id", ev.id);
    if (error) return setError(errorText(error));
    void load();
  }

  const mine = events?.filter((e) => e.creator_id === userId) ?? [];
  const others = events?.filter((e) => e.creator_id !== userId) ?? [];

  const list = (items: BoolaaEvent[], empty: string) =>
    items.length === 0 ? (
      <p className="card px-4 py-6 text-center text-sm text-muted">{empty}</p>
    ) : (
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((ev) => (
          <EventCard
            key={ev.id}
            ev={ev}
            now={now}
            mine={ev.creator_id === userId}
            going={ev.rsvp_list.includes(userId)}
            onRsvp={() => toggleRsvp(ev)}
            onEdit={() => setEditing(ev)}
            onDelete={() => remove(ev)}
          />
        ))}
      </ul>
    );

  return (
    <div>
      <ErrorText>{error}</ErrorText>
      <div className="mb-4 flex justify-end">
        <button type="button" className="btn-primary" data-testid="new-event" onClick={() => setEditing("new")}>
          <Plus size={18} /> {t("newEvent")}
        </button>
      </div>
      {events === null ? (
        <PageLoader />
      ) : events.length === 0 ? (
        <EmptyState icon={<CalendarDays size={32} />} title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : (
        <>
          <SectionTitle>{t("myEvents")}</SectionTitle>
          {list(mine, t("emptyMine"))}
          <SectionTitle>{t("bubbleEvents")}</SectionTitle>
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
  now,
  mine,
  going,
  onRsvp,
  onEdit,
  onDelete,
}: {
  ev: BoolaaEvent;
  now: number;
  mine: boolean;
  going: boolean;
  onRsvp: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("events");
  const tc = useTranslations("common");
  const fmt = useFormat();
  const past = new Date(ev.datetime).getTime() < now;
  return (
    <li className={cx("card flex flex-col gap-3 p-4", past && "opacity-60")} data-testid="event-card">
      <div className="flex gap-3">
        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand/15 text-brand">
          <span className="text-[11px] font-semibold uppercase">{fmt.month(ev.datetime)}</span>
          <span className="text-xl font-bold leading-none">{fmt.day(ev.datetime)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{ev.title}</h3>
          <p className="text-sm text-muted">{fmt.dateTime(ev.datetime)}</p>
          {ev.location && (
            <p className="flex items-center gap-1 text-sm text-muted">
              <MapPin size={14} /> {ev.location}
            </p>
          )}
        </div>
        {mine && (
          <div className="flex gap-1">
            <button type="button" aria-label={t("editEvent")} onClick={onEdit} className="h-8 w-8 rounded-full text-muted hover:bg-chip hover:text-brand">
              <Pencil size={16} className="mx-auto" />
            </button>
            <button type="button" aria-label={t("deleteEvent")} onClick={onDelete} className="h-8 w-8 rounded-full text-muted hover:bg-chip hover:text-red-500">
              <Trash2 size={16} className="mx-auto" />
            </button>
          </div>
        )}
      </div>
      {ev.description && <p className="text-[15px]">{ev.description}</p>}
      <p className="text-sm text-muted" data-testid="rsvp-count" data-count={ev.rsvp_list.length}>
        {t("goingCount", { count: ev.rsvp_list.length })}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
          <Avatar name={ev.creator?.name} src={ev.creator?.avatar} size={24} />
          <span className="truncate">{ev.creator?.name ?? tc("someone")}</span>
        </span>
        <button
          type="button"
          onClick={onRsvp}
          aria-pressed={going}
          data-testid="rsvp-button"
          className={cx("chip", going ? "bg-brand text-white" : "bg-chip text-brand hover:bg-brand/15")}
        >
          {going ? <Check size={16} /> : <Users size={16} />}
          {going ? t("going") : t("rsvp")}
        </button>
      </div>
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
      <button type="submit" className="btn-primary w-full" disabled={busy || !title.trim() || !when}>
        {busy ? t("common.saving") : event ? t("common.saveChanges") : t("events.create")}
      </button>
    </form>
  );
}
