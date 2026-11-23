"use client";

/**
 * "I want it" on food posts and market items (docs/boolaa-spec.md, "Requests and picking"): the request
 * rows (loaded after the list, live on the screen's channel), the card controls for members and owners,
 * the "I want it" dialog and the owner's Requests sheet. Every write is an RPC; the item's
 * `request_count` / `availability` arrive through the screen's own item feed.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Check, CircleSlash, Hand, Hourglass, Inbox, PartyPopper, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BoolaaClient } from "@/lib/supabase/client";
import { Avatar, EmptyState, Modal } from "@/components/ui";
import { cheer } from "@/components/cheer";
import { announce } from "@/lib/a11y";
import { errorKey } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { hueClass, type Hue } from "@/lib/hue";
import { cx } from "@/lib/utils";
import type { Author } from "@/lib/types";
import {
  NOTE_MAX,
  REQUEST_SELECT,
  cleanNote,
  myRequest,
  ownerRows,
  pickOf,
  removeRequest,
  requesterState,
  upsertRequest,
  type ItemKind,
  type ItemRequest,
} from "@/lib/requests";

/** What the request UI needs to know about a food post or market item. */
export type RequestableItem = {
  id: string;
  ownerId: string;
  ownerName: string;
  /** Market title, or the food description ("" when none). */
  title: string;
  availability: string;
  requestCount: number;
};

/** Errors after which the list is out of date: reload it (spec, "Errors → messages"). */
const STALE = new Set(["itemGone", "itemNotAvailable", "requestGone"]);

export function useItemRequests(opts: {
  supabase: BoolaaClient;
  bubbleId: string;
  kind: ItemKind;
  userId: string;
  me: Author | null;
  /** Optimistic change of the item row (availability); the item feed brings the server's value. */
  patchItem: (itemId: string, patch: { availability: string }) => void;
  /** Reload items + requests after an error that means the screen is stale. */
  reloadAll: () => unknown;
  onError: (e: unknown) => void;
}) {
  const { supabase, bubbleId, kind, userId } = opts;
  const ref = useRef(opts);
  useEffect(() => {
    ref.current = opts;
  });
  const [rows, setRows] = useState<ItemRequest[]>([]);

  // A new bubble starts empty.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows([]);
  }, [bubbleId, kind]);

  /** RLS returns exactly my own requests plus the requests on my items. */
  const reload = useCallback(async () => {
    const { data, error } = await supabase.from("item_requests").select(REQUEST_SELECT).eq("bubble_id", bubbleId).eq("item_kind", kind);
    if (error) return false;
    setRows((data ?? []) as unknown as ItemRequest[]);
    return true;
  }, [supabase, bubbleId, kind]);

  const fetchOne = useCallback(
    async (id: string) => {
      const { data } = await supabase.from("item_requests").select(REQUEST_SELECT).eq("id", id).maybeSingle();
      if (data) setRows((prev) => upsertRequest(prev, data as unknown as ItemRequest));
    },
    [supabase],
  );

  /** Listeners on the screen's channel: INSERT / UPDATE filtered by bubble, DELETE by primary key only. */
  const bind = useCallback(
    (ch: RealtimeChannel) =>
      ch
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "item_requests", filter: `bubble_id=eq.${bubbleId}` }, (p) => {
          const row = p.new as ItemRequest;
          if (row.item_kind === kind) void fetchOne(row.id);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "item_requests", filter: `bubble_id=eq.${bubbleId}` }, (p) => {
          const row = p.new as ItemRequest;
          if (row.item_kind !== kind) return;
          setRows((prev) => {
            if (prev.some((r) => r.id === row.id)) return upsertRequest(prev, row);
            void fetchOne(row.id);
            return prev;
          });
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "item_requests" }, (p) => {
          const id = (p.old as Partial<ItemRequest>).id;
          if (id) setRows((prev) => removeRequest(prev, id));
        }),
    [bubbleId, kind, fetchOne],
  );

  const fail = useCallback((e: unknown) => {
    ref.current.onError(e);
    if (STALE.has(errorKey(e))) void ref.current.reloadAll();
  }, []);

  const request = useCallback(
    async (item: RequestableItem, note: string) => {
      const temp: ItemRequest = {
        id: `pending-${item.id}`,
        bubble_id: bubbleId,
        owner_id: item.ownerId,
        requester_id: userId,
        item_kind: kind,
        item_id: item.id,
        food_post_id: kind === "food" ? item.id : null,
        market_item_id: kind === "market" ? item.id : null,
        note: cleanNote(note),
        status: "pending",
        created_at: new Date().toISOString(),
        status_changed_at: new Date().toISOString(),
        requester: ref.current.me,
      };
      setRows((prev) => [...prev, temp]);
      const { data, error } = await supabase.rpc("request_item", { p_kind: kind, p_item_id: item.id, p_note: cleanNote(note) ?? undefined });
      setRows((prev) => {
        const without = removeRequest(prev, temp.id);
        return error || !data ? without : upsertRequest(without, { ...(data as ItemRequest), requester: ref.current.me });
      });
      if (error) {
        fail(error);
        return false;
      }
      return true;
    },
    [supabase, bubbleId, kind, userId, fail],
  );

  const withdraw = useCallback(
    async (r: ItemRequest) => {
      setRows((prev) => removeRequest(prev, r.id));
      const wasPicked = r.status === "picked";
      if (wasPicked && r.item_id) ref.current.patchItem(r.item_id, { availability: "available" });
      const { error } = await supabase.rpc("withdraw_item_request", { p_request_id: r.id });
      if (error) {
        setRows((prev) => upsertRequest(prev, r));
        if (wasPicked && r.item_id) ref.current.patchItem(r.item_id, { availability: "reserved" });
        fail(error);
        return false;
      }
      return true; // `false` from the RPC: already gone, which is what we wanted
    },
    [supabase, fail],
  );

  const pick = useCallback(
    async (r: ItemRequest) => {
      const { data, error } = await supabase.rpc("pick_item_request", { p_request_id: r.id });
      if (error) {
        if (errorKey(error) === "requestGone") setRows((prev) => removeRequest(prev, r.id));
        fail(error);
        return false;
      }
      setRows((prev) =>
        prev.map((x) =>
          x.item_id !== r.item_id ? x : x.id === r.id ? { ...x, ...(data as ItemRequest), requester: x.requester } : x.status === "picked" ? { ...x, status: "pending" } : x,
        ),
      );
      if (r.item_id) ref.current.patchItem(r.item_id, { availability: "reserved" });
      return true;
    },
    [supabase, fail],
  );

  const unpick = useCallback(
    async (itemId: string) => {
      const { error } = await supabase.rpc("unpick_item", { p_kind: kind, p_item_id: itemId });
      if (error) {
        fail(error);
        return false;
      }
      setRows((prev) => prev.map((x) => (x.item_id === itemId && x.status === "picked" ? { ...x, status: "pending" } : x)));
      ref.current.patchItem(itemId, { availability: "available" });
      return true;
    },
    [supabase, kind, fail],
  );

  const handOver = useCallback(
    async (itemId: string) => {
      const { error } = await supabase.rpc("hand_over_item", { p_kind: kind, p_item_id: itemId });
      if (error) {
        fail(error);
        return false;
      }
      setRows((prev) =>
        prev.map((x) => (x.item_id !== itemId ? x : x.status === "picked" ? { ...x, status: "received" } : x.status === "pending" ? { ...x, status: "missed" } : x)),
      );
      ref.current.patchItem(itemId, { availability: "taken" });
      return true;
    },
    [supabase, kind, fail],
  );

  return { rows, reload, bind, request, withdraw, pick, unpick, handOver };
}

export type ItemRequests = ReturnType<typeof useItemRequests>;

/** "3 requests" pill; the owner's opens the Requests sheet. */
export function RequestCountPill({ count, onClick, className }: { count: number; onClick?: () => void; className?: string }) {
  const t = useTranslations("requests");
  const cls = cx(
    "inline-flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-1 font-display text-xs font-extrabold text-fg shadow-soft",
    onClick && "pointer-events-auto press hover:brightness-105",
    className,
  );
  const body = (
    <>
      <Hand size={13} strokeWidth={2.6} aria-hidden /> {t("count", { count })}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} data-testid="request-count">
      {body}
    </button>
  ) : (
    <span className={cls} data-testid="request-count">
      {body}
    </span>
  );
}

/** Reserved / Taken badge; `label` replaces the text ("Reserved for you", "Reserved for Ana"). */
export function AvailabilityBadge({
  availability,
  label,
  filled,
  hue,
  className,
}: {
  availability: string;
  label?: string;
  /** "Reserved for you" / "It's yours": filled in the feature colour. */
  filled?: boolean;
  hue?: Hue;
  className?: string;
}) {
  const t = useTranslations("market");
  if (availability !== "reserved" && availability !== "taken" && !filled) return null;
  const reserved = availability === "reserved";
  return (
    <span
      data-testid="availability-badge"
      data-availability={availability}
      className={cx(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 font-display text-xs font-black uppercase tracking-wide shadow-glow",
        filled ? cx(hueClass(hue ?? "mint"), "bg-hue-grad text-onfill") : reserved ? "hue-tangerine bg-hue-grad text-onfill" : "bg-taken text-white",
        className,
      )}
    >
      {filled ? <Check size={13} strokeWidth={3} aria-hidden /> : reserved ? <Hourglass size={13} strokeWidth={2.6} aria-hidden /> : <CircleSlash size={13} strokeWidth={2.6} aria-hidden />}
      <span className="truncate">{label ?? t(reserved ? "reserved" : "taken")}</span>
    </span>
  );
}

/** Small confirmation dialog (Withdraw / Hand over / clear pick). */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  hue,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  hue: Hue;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const tc = useTranslations("common");
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {open && (
        <div className="space-y-5" data-testid="confirm-dialog">
          <p className="text-[15px] text-muted">{body}</p>
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <button type="button" data-autofocus className={cx("btn-primary flex-1", hueClass(hue))} onClick={onConfirm} data-testid="confirm-yes">
              {confirmLabel}
            </button>
            <button type="button" className="btn-ghost flex-1" onClick={onClose}>
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** "I want it" dialog: an optional note (≤ 200, live counter) and "Send request". */
function IWantItForm({ hue, onSend, onCancel }: { hue: Hue; onSend: (note: string) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations("requests");
  const tc = useTranslations("common");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSend(note);
        setBusy(false);
      }}
    >
      <div>
        <label className="label" htmlFor="request-note">
          {t("notePlaceholder")}
        </label>
        <textarea
          id="request-note"
          className="input min-h-24"
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          placeholder={t("notePlaceholder")}
          aria-describedby="request-note-count"
          data-testid="request-note"
        />
        <p id="request-note-count" className="mt-1 text-right text-xs tabular-nums text-muted" aria-live="off">
          {note.length}/{NOTE_MAX}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <button type="submit" className={cx("btn-primary flex-1", hueClass(hue))} disabled={busy} data-testid="send-request">
          {t("send")}
        </button>
        <button type="button" className="btn-ghost flex-1" onClick={onCancel}>
          {tc("cancel")}
        </button>
      </div>
    </form>
  );
}

/** The owner's Requests sheet: oldest first, the pick pinned on top; hand-over asks first (in place). */
function RequestsSheetBody({
  kind,
  item,
  rows,
  hue,
  flows,
  onClose,
}: {
  kind: ItemKind;
  item: RequestableItem;
  rows: ItemRequest[];
  hue: Hue;
  flows: ItemRequests;
  onClose: () => void;
}) {
  const t = useTranslations("requests");
  const tc = useTranslations("common");
  const fmt = useFormat();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = rows.find((r) => r.status === "picked") ?? null;
  const nameOf = (r: ItemRequest) => r.requester?.name ?? tc("someone");

  async function run(action: () => Promise<boolean>, after?: () => void) {
    setBusy(true);
    const ok = await action();
    setBusy(false);
    if (ok) after?.();
  }

  if (confirming && pick) {
    return (
      <div className="space-y-5" data-testid="handover-confirm">
        <p className="font-display text-[17px] font-black">{t("handOverTitle")}</p>
        <p className="text-[15px] text-muted">
          {kind === "food" ? t("handOverBodyFood", { name: nameOf(pick) }) : t("handOverBodyMarket", { name: nameOf(pick), title: item.title })}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <button
            type="button"
            data-autofocus
            className={cx("btn-primary flex-1", hueClass(hue))}
            disabled={busy}
            data-testid="handover-yes"
            onClick={() =>
              run(
                () => flows.handOver(item.id),
                () => {
                  announce(t("youGotIt"));
                  onClose();
                },
              )
            }
          >
            {t("handOver")}
          </button>
          <button type="button" className="btn-ghost flex-1" onClick={() => setConfirming(false)}>
            {tc("cancel")}
          </button>
        </div>
      </div>
    );
  }

  if (rows.length === 0) return <EmptyState title={t("noneYet")} hint={t("noneYetHint")} hue={hue} expression="curious" testId="requests-empty" />;

  return (
    <ul className="space-y-3" data-testid="requests-list">
      {rows.map((r) => {
        const picked = r.status === "picked";
        const name = nameOf(r);
        return (
          <li
            key={r.id}
            data-testid="request-row"
            data-status={r.status}
            className={cx("rounded-card border border-line p-3", picked && cx(hueClass(hue), "bg-hue-wash"))}
          >
            <div className="flex items-start gap-3">
              <Avatar name={r.requester?.name} id={r.requester_id} src={r.requester?.avatar} size={40} decorative />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-display font-extrabold">{name}</span>
                  {picked && (
                    <span className={cx(hueClass(hue), "rounded-full bg-hue-grad px-2 py-0.5 font-display text-[11px] font-black uppercase tracking-wide text-onfill")} data-testid="your-pick">
                      {t("yourPick")}
                    </span>
                  )}
                  <span className="text-xs text-muted">{fmt.relative(r.created_at)}</span>
                </p>
                {r.note && <p className="mt-1 whitespace-pre-wrap break-words text-[15px]">{r.note}</p>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {picked ? (
                <>
                  <button type="button" className={cx("btn-primary min-h-11 flex-1", hueClass(hue))} disabled={busy} onClick={() => setConfirming(true)} data-testid="handover">
                    <PartyPopper size={17} aria-hidden /> {t("handOver")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost min-h-11"
                    disabled={busy}
                    data-testid="undo-pick"
                    aria-label={t("actionA11y", { action: t("undoPick"), target: name })}
                    onClick={() => run(() => flows.unpick(item.id), () => announce(t("undoPick")))}
                  >
                    <Undo2 size={17} aria-hidden /> {t("undoPick")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={cx("chip min-h-11", hueClass(hue), "bg-hue-wash text-hue-ink")}
                  disabled={busy}
                  data-testid="pick"
                  aria-label={t("actionA11y", { action: pick ? t("pickInstead") : t("pick"), target: name })}
                  onClick={() => run(() => flows.pick(r), () => cheer(t("pickedToast", { name }), hue))}
                >
                  {pick ? t("pickInstead") : t("pick")}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Everything a list screen needs for requests: the card pieces (`badge`, `pill`, `actions`), the dialogs
 * (`dialogs`, render once) and `openSheet`. Also opens the sheet from a push (`?requests=1` next to the
 * item parameter, `?requests=<item id>`, added by the service worker for `item_request` / `item_request_withdrawn`).
 */
export function useRequestUI(opts: {
  kind: ItemKind;
  hue: Hue;
  userId: string;
  items: RequestableItem[] | null;
  flows: ItemRequests;
}) {
  const { kind, hue, userId, items, flows } = opts;
  const t = useTranslations("requests");
  const tc = useTranslations("common");
  const [asking, setAsking] = useState<RequestableItem | null>(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<{ item: RequestableItem; request: ItemRequest } | null>(null);

  // Push deep link: `?requests=<item id>` (the item parameter itself is DeepLinkTarget's, which may drop it
  // first). `requests` stays in the address bar until the item is on screen, because the screen may mount again
  // when the provider switches to the push's bubble.
  const deepLink = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (deepLink.current !== undefined) return;
    deepLink.current = new URLSearchParams(window.location.search).get("requests");
  }, []);
  useEffect(() => {
    const id = deepLink.current;
    if (!id || !items || !userId) return;
    const item = items.find((i) => i.id === id);
    if (!item) return; // not this bubble's list (yet)
    deepLink.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("requests");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    if (item.ownerId === userId) setSheetFor(id);
  }, [items, userId]);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const sheetItem = sheetFor ? byId.get(sheetFor) ?? null : null;
  const label = (item: RequestableItem) => item.title || tc("someone");

  /** Badge over the photo: "Reserved for you" / "Reserved for Ana" / "It's yours", else Reserved / Taken. */
  function badge(item: RequestableItem, className?: string): ReactNode {
    const mine = myRequest(flows.rows, item.id, userId);
    if (mine?.status === "picked" && item.availability === "reserved")
      return <AvailabilityBadge availability="reserved" filled hue={hue} label={t("reservedForYou")} className={className} />;
    if (mine?.status === "received") return <AvailabilityBadge availability="taken" filled hue={hue} label={t("youGotIt")} className={className} />;
    if (item.ownerId === userId && item.availability === "reserved") {
      const p = pickOf(flows.rows, item.id);
      if (p) return <AvailabilityBadge availability="reserved" label={t("reservedFor", { name: p.requester?.name ?? tc("someone") })} className={className} />;
    }
    return <AvailabilityBadge availability={item.availability} className={className} />;
  }

  /** "3 requests" for everyone while the item isn't taken; the owner's opens the sheet. */
  function pill(item: RequestableItem, className?: string): ReactNode {
    if (item.availability === "taken" || item.requestCount <= 0) return null;
    return <RequestCountPill count={item.requestCount} className={className} onClick={item.ownerId === userId ? () => setSheetFor(item.id) : undefined} />;
  }

  /** The action row: owner → Requests button; others → I want it / Requested / Withdraw / outcome. */
  function actions(item: RequestableItem): ReactNode {
    if (item.ownerId === userId) {
      if (item.availability === "taken") return null;
      return item.requestCount > 0 ? (
        <button type="button" className={cx("chip min-h-11 self-start", hueClass(hue), "bg-hue-wash text-hue-ink")} onClick={() => setSheetFor(item.id)} data-testid="open-requests">
          <Inbox size={16} aria-hidden /> {t("button", { count: item.requestCount })}
        </button>
      ) : (
        <p className="text-sm text-muted" data-testid="no-requests">
          {t("noneYet")}
        </p>
      );
    }
    const mine = myRequest(flows.rows, item.id, userId);
    const state = requesterState(item.availability, mine);
    const withdrawButton = mine && (
      <button
        type="button"
        className="min-h-11 px-1 text-sm font-bold text-muted underline-offset-2 hover:text-fg hover:underline"
        data-testid="withdraw-request"
        aria-label={t("actionA11y", { action: t("withdraw"), target: label(item) })}
        onClick={() => (mine.status === "picked" ? setWithdrawing({ item, request: mine }) : void flows.withdraw(mine))}
      >
        {t("withdraw")}
      </button>
    );
    switch (state) {
      case "ask":
        return (
          <button
            type="button"
            className={cx("btn-primary min-h-11 self-start px-4", hueClass(hue))}
            data-testid="i-want-it"
            aria-label={t("iWantItA11y", { title: label(item) })}
            onClick={() => setAsking(item)}
          >
            <Hand size={17} aria-hidden /> {t("iWantIt")}
          </button>
        );
      case "pending":
      case "onList":
        return (
          <div className="flex flex-wrap items-center gap-2" data-testid="my-request" data-state={state}>
            <span className={cx("inline-flex min-h-9 items-center gap-1.5 rounded-full border-[1.5px] px-3 font-display text-sm font-bold", hueClass(hue), "border-hue-ink/50 text-hue-ink")}>
              <Check size={15} strokeWidth={3} aria-hidden /> {state === "onList" ? t("onList") : t("requested")}
            </span>
            {withdrawButton}
          </div>
        );
      case "picked":
        return (
          <div className="flex flex-wrap items-center gap-2" data-testid="my-request" data-state={state}>
            {withdrawButton}
          </div>
        );
      case "missed":
        return (
          <p className="text-sm text-muted" data-testid="my-request" data-state={state}>
            {t("someoneElse")}
          </p>
        );
      default:
        return null; // "none" (reserved for someone else) and "received" (the badge says it)
    }
  }

  const dialogs = (
    <>
      <Modal open={asking !== null} onClose={() => setAsking(null)} title={t("iWantIt")}>
        {asking && (
            <IWantItForm
              key={asking.id}
              hue={hue}
              onCancel={() => setAsking(null)}
              onSend={async (note) => {
                const item = asking;
                // Shown at once: the card switches to "Requested"; rolled back on error.
                setAsking(null);
                const ok = await flows.request(item, note);
                if (ok) cheer(t("sentToast", { name: item.ownerName }), hue);
              }}
            />
        )}
      </Modal>
      <Modal open={sheetItem !== null} onClose={() => setSheetFor(null)} title={t("title")}>
        {sheetItem && (
          <RequestsSheetBody kind={kind} item={sheetItem} rows={ownerRows(flows.rows, sheetItem.id)} hue={hue} flows={flows} onClose={() => setSheetFor(null)} />
        )}
      </Modal>
      <ConfirmDialog
        open={withdrawing !== null}
        title={t("withdrawConfirmTitle")}
        body={withdrawing ? t("withdrawConfirmBody", { name: withdrawing.item.ownerName }) : ""}
        confirmLabel={t("withdraw")}
        hue={hue}
        onClose={() => setWithdrawing(null)}
        onConfirm={() => {
          const w = withdrawing;
          setWithdrawing(null);
          if (w) void flows.withdraw(w.request);
        }}
      />
    </>
  );

  return { badge, pill, actions, dialogs, openSheet: setSheetFor };
}
