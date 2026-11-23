"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { Modal, Spinner } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";
import { cx } from "@/lib/utils";
import { storageUrlOf, useSignedUrl, type PhotoBucket } from "@/lib/storage-url";
import { A, REASON_LABEL, STATUS_LABEL, TARGET_LABEL } from "./strings";

type Queue = "open" | "actioned" | "dismissed";
type Action = "dismiss" | "delete_content" | "remove_from_bubble" | "suspend" | "ban";

type Snapshot = {
  text?: string;
  title?: string;
  url?: string;
  image?: string;
  /** Chat photos live in the private chat.images bucket: a path to sign, not a URL. */
  image_bucket?: string;
  image_path?: string;
  /** A chat message its author deleted while a report was open: the text/photo are the kept evidence. */
  deleted_by_author?: boolean;
  deleted: boolean;
};
type Report = {
  id: string;
  reason: string;
  details: string | null;
  created_at: string;
  status: Queue;
  handled_at: string | null;
  handled_note: string | null;
  target_type: string;
  target_id: string;
  bubble_id: string | null;
  bubble_name: string | null;
  reporter_id: string | null;
  reporter_name: string | null;
  reported_user_id: string | null;
  reported_user_name: string | null;
  reported_user_status: string | null;
  reported_user_status_until: string | null;
  reported_user_is_member: boolean;
  snapshot: Snapshot;
  open_reports_against_user_30d: number;
  open_reports_on_target: number;
};
type ContextMessage = { id: string; sender_name: string | null; content: string; created_at: string; is_target: boolean };
type Related = { id: string; reason: string; status: string; created_at: string; reporter_name: string | null; details: string | null };
type AuditEntry = { id: string; action: string; note: string | null; created_at: string; details: Record<string, unknown> };
type ReportDetail = Report & { context: ContextMessage[]; related: Related[]; actions: AuditEntry[] };
type AdminUser = {
  id: string;
  name: string;
  status: string;
  status_reason: string | null;
  status_until: string | null;
  active: boolean;
  bubbles: number;
  open_reports_30d: number;
  reports_total: number;
};

const PAGE = 50;
const SLA_WARN_MS = 20 * 60 * 60 * 1000;

/** Re-renders every minute so "x min ago" and the 20 h warning stay current. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function errorNode(e: unknown): ReactNode {
  const msg = (e as { message?: string })?.message ?? A.errors.generic;
  if (msg === "session not verified")
    return (
      <>
        {A.errors.notVerified}{" "}
        <a className="font-semibold underline" href="/verify?next=%2Fadmin">
          {A.errors.verifyLink}
        </a>
      </>
    );
  return msg;
}

function Banner({ kind, children, onClose }: { kind: "ok" | "error"; children: ReactNode; onClose?: () => void }) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      data-testid={kind === "error" ? "admin-error" : "admin-notice"}
      className={cx(
        "flex items-start justify-between gap-3 rounded-field px-4 py-2.5 text-sm font-medium",
        kind === "error" ? "bg-danger/10 text-danger-ink" : "bg-mint/15 text-mint-ink",
      )}
    >
      <span>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="text-xs font-bold opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </div>
  );
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold", className)}>{children}</span>;
}

function ReasonBadge({ reason }: { reason: string }) {
  if (reason === "self_harm")
    return (
      <Pill className="gap-1 bg-danger text-white">
        <ShieldAlert size={13} aria-hidden /> {A.urgent} · {REASON_LABEL.self_harm}
      </Pill>
    );
  return <Pill className="bg-field text-fg">{REASON_LABEL[reason] ?? reason}</Pill>;
}

function UserStatus({ status, until, ended }: { status: string | null; until: string | null; ended?: boolean }) {
  if (!status || status === "active") return null;
  return (
    <Pill className={ended ? "bg-field text-muted" : "bg-danger/10 text-danger-ink"}>
      {STATUS_LABEL[status] ?? status}
      {status === "suspended" && until ? ` until ${fmt(until)}` : ""}
      {ended ? ` (${A.users.ended})` : ""}
    </Pill>
  );
}

function SnapshotView({ r }: { r: Report }) {
  const s = r.snapshot;
  // Every photo bucket is private: admins read reported photos through signed URLs (lib/storage-url).
  const stored = s.image ?? (s.image_bucket && s.image_path ? storageUrlOf(s.image_bucket as PhotoBucket, s.image_path) : null);
  const { url: image, onError } = useSignedUrl(stored);
  if (s.deleted)
    return <p className="rounded-small bg-field px-3 py-2 text-sm italic text-muted">{A.contentDeleted}</p>;
  return (
    <div className="flex gap-3 rounded-small bg-field px-3 py-2 text-sm" data-testid="admin-snapshot">
      {image && (
        <a href={image} target="_blank" rel="noreferrer" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} onError={onError} alt="" className="h-16 w-16 rounded-small object-cover" data-testid="admin-snapshot-image" />
        </a>
      )}
      <div className="min-w-0 space-y-0.5">
        {s.deleted_by_author && <p className="text-xs font-semibold text-danger-ink">{A.deletedByAuthor}</p>}
        {r.target_type === "user" && <p className="text-xs text-muted">{A.profileReport}</p>}
        {s.title && <p className="font-semibold">{s.title}</p>}
        {s.text && <p className="whitespace-pre-wrap break-words">{s.text}</p>}
        {s.url && (
          <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-brand-ink underline">
            {s.url} <ExternalLink size={12} aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}

type Pending = { action: Action; days?: number };

function ReportCard({ r, now, linked, onDone }: { r: Report; now: number; linked?: boolean; onDone: (msg: string) => void }) {
  const supabase = getSupabase();
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);

  const loadDetail = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_get_report", { p_report_id: r.id });
    if (error) setError(errorNode(error));
    else setDetail(data as unknown as ReportDetail);
  }, [supabase, r.id]);

  useEffect(() => {
    // The linked report (from the alert email) opens with its context.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (linked) void loadDetail().then(() => setShowContext(true));
  }, [linked, loadDetail]);

  const toggleContext = async () => {
    if (!showContext && !detail) await loadDetail();
    setShowContext((v) => !v);
  };

  const who = r.reported_user_name ?? A.deletedUser;
  const target = TARGET_LABEL[r.target_type] ?? r.target_type;
  const age = now - new Date(r.created_at).getTime();
  const late = r.status === "open" && age > SLA_WARN_MS;
  const isOpen = r.status === "open";
  const userGone = !r.reported_user_id || !r.reported_user_name;
  const banned = r.reported_user_status === "banned";

  const confirmText = (p: Pending) => {
    switch (p.action) {
      case "dismiss":
        return A.confirm.dismiss(who);
      case "delete_content":
        return A.confirm.delete_content(target);
      case "remove_from_bubble":
        return A.confirm.remove_from_bubble(who, r.bubble_name ?? A.noBubble);
      case "suspend":
        return A.confirm.suspend(who, p.days ?? 1);
      case "ban":
        return A.confirm.ban(who);
    }
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("admin_resolve_report", {
      p_report_id: r.id,
      p_action: pending.action,
      p_note: note.trim() || undefined,
      p_days: pending.days,
    });
    setBusy(false);
    setPending(null);
    if (error) {
      setError(errorNode(error));
      return;
    }
    const res = data as { duplicates_closed?: number; image_bucket?: string; image_path?: string } | null;
    const closed = Number(res?.duplicates_closed ?? 0);
    // The image buckets are public: remove the deleted post's photo too (policy in
    // 20261122210000_moderation_image_cleanup.sql allows exactly this object).
    let imageNote = "";
    if (res?.image_bucket && res.image_path) {
      const { data: removed, error: rmError } = await supabase.storage.from(res.image_bucket).remove([res.image_path]);
      imageNote = rmError || !removed?.length ? A.imageNotRemoved(res.image_bucket, res.image_path) : A.imageRemoved;
    }
    onDone(A.done[pending.action] + imageNote + A.duplicatesClosed(closed));
  };

  const actionBtn = "inline-flex min-h-9 items-center rounded-field bg-field px-3 text-sm font-bold text-fg transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40";
  const dangerBtn = "inline-flex min-h-9 items-center rounded-field bg-danger/10 px-3 text-sm font-bold text-danger-ink transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <article
      data-testid="admin-report"
      data-report-id={r.id}
      className={cx("card space-y-3 p-4", linked && "ring-2 ring-grape", r.reason === "self_harm" && isOpen && "ring-2 ring-danger")}
    >
      {linked && <p className="text-xs font-bold uppercase tracking-wide text-brand-ink">{A.linked}</p>}
      <header className="flex flex-wrap items-center gap-2">
        <ReasonBadge reason={r.reason} />
        <Pill className="bg-field text-muted">{target}</Pill>
        <UserStatus
          status={r.reported_user_status}
          until={r.reported_user_status_until}
          ended={!!r.reported_user_status_until && new Date(r.reported_user_status_until).getTime() <= now}
        />
        <time
          dateTime={r.created_at}
          title={fmt(r.created_at)}
          data-testid="admin-report-age"
          data-late={late || undefined}
          className={cx("ml-auto text-sm", late ? "font-bold text-danger-ink" : "text-muted")}
        >
          {A.ago(age)}
        </time>
      </header>

      <SnapshotView r={r} />

      <p className="text-sm">
        <strong>{r.reporter_name ?? A.deletedUser}</strong> {A.reportedBy} <strong>{who}</strong> {A.in}{" "}
        <strong>{r.bubble_name ?? A.noBubble}</strong>
        <span className="mt-0.5 block font-mono text-[11px] text-muted">
          reporter {r.reporter_id ?? "n/a"} · reported {r.reported_user_id ?? "n/a"} · bubble {r.bubble_id ?? "n/a"} · report {r.id}
        </span>
      </p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className={cx(r.open_reports_against_user_30d > 1 ? "font-bold text-danger-ink" : "text-muted")} data-testid="admin-open-count">
          {A.openReports30d(r.open_reports_against_user_30d)}
        </span>
        {r.open_reports_on_target > 1 && <span className="text-muted">{A.onTarget(r.open_reports_on_target)}</span>}
      </div>

      {r.details && (
        <blockquote className="border-l-2 border-line pl-3 text-sm">
          <span className="block text-xs font-semibold text-muted">{A.details}</span>
          {r.details}
        </blockquote>
      )}

      <div>
        <button type="button" onClick={toggleContext} className="text-sm font-semibold text-brand-ink hover:underline" data-testid="admin-context-toggle">
          {showContext ? A.hideContext : A.showContext}
        </button>
        {showContext && detail && (
          <div className="mt-2 space-y-3 text-sm" data-testid="admin-context">
            {r.target_type === "chat_message" && (
              <ol className="space-y-1 rounded-small bg-field p-2">
                {detail.context.length === 0 && <li className="text-muted">{A.noContext}</li>}
                {detail.context.map((m) => (
                  <li key={m.id} className={cx("rounded-small px-2 py-1", m.is_target && "bg-danger/10 font-semibold")}>
                    <span className="text-muted">{fmt(m.created_at)} · </span>
                    <strong>{m.sender_name ?? A.deletedUser}:</strong> {m.content}
                  </li>
                ))}
              </ol>
            )}
            {detail.related.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted">{A.related}</p>
                <ul className="mt-1 space-y-0.5">
                  {detail.related.map((o) => (
                    <li key={o.id}>
                      {REASON_LABEL[o.reason] ?? o.reason} · {o.reporter_name ?? A.deletedUser} · {fmt(o.created_at)} · {o.status}
                      {o.details ? ` · "${o.details}"` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detail.actions.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted">{A.history}</p>
                <ul className="mt-1 space-y-0.5">
                  {detail.actions.map((a) => (
                    <li key={a.id}>
                      {fmt(a.created_at)} · {a.action}
                      {a.note ? ` · ${a.note}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {!isOpen && (
        <p className="text-sm text-muted">
          {A.handled(A.queue[r.status], r.handled_at ? fmt(r.handled_at) : "")}
          {r.handled_note ? ` · ${r.handled_note}` : ""}
        </p>
      )}

      {error && <Banner kind="error">{error}</Banner>}

      {isOpen && (
        <div className="space-y-2 border-t border-line pt-3">
          <label className="sr-only" htmlFor={`note-${r.id}`}>
            {A.note}
          </label>
          <textarea
            id={`note-${r.id}`}
            data-testid="admin-note"
            rows={1}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`${A.note}: ${A.notePlaceholder}`}
            className="w-full resize-y rounded-small border-2 border-transparent bg-field px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-grape"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={actionBtn} data-testid="admin-action-dismiss" onClick={() => setPending({ action: "dismiss" })}>
              {A.actions.dismiss}
            </button>
            <button
              type="button"
              className={actionBtn}
              data-testid="admin-action-delete"
              disabled={r.target_type === "user" || r.snapshot.deleted}
              onClick={() => setPending({ action: "delete_content" })}
            >
              {A.actions.delete_content}
            </button>
            <button
              type="button"
              className={actionBtn}
              data-testid="admin-action-remove"
              disabled={userGone || !r.reported_user_is_member}
              onClick={() => setPending({ action: "remove_from_bubble" })}
            >
              {A.actions.remove_from_bubble}
            </button>
            {([1, 7, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={dangerBtn}
                data-testid={`admin-action-suspend-${d}`}
                disabled={userGone || banned}
                onClick={() => setPending({ action: "suspend", days: d })}
              >
                {A.actions[`suspend${d}`]}
              </button>
            ))}
            <button
              type="button"
              className={dangerBtn}
              data-testid="admin-action-ban"
              disabled={userGone || banned}
              onClick={() => setPending({ action: "ban" })}
            >
              {A.actions.ban}
            </button>
          </div>
        </div>
      )}

      <Modal calm open={!!pending} onClose={() => !busy && setPending(null)} title={A.confirm.title}>
        {pending && (
          <div className="space-y-4" data-testid="admin-confirm">
            <p className="text-[15px]">{confirmText(pending)}</p>
            {note.trim() && <p className="rounded-small bg-field px-3 py-2 text-sm">{note.trim()}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-calm-ghost" onClick={() => setPending(null)} disabled={busy}>
                {A.confirm.cancel}
              </button>
              <button
                type="button"
                className={pending.action === "dismiss" ? "btn-calm" : "btn-destructive"}
                onClick={run}
                disabled={busy}
                data-testid="admin-confirm-go"
              >
                {busy ? A.confirm.working : A.confirm.go}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </article>
  );
}

function ReportsPanel({ onNotice }: { onNotice: (m: string) => void }) {
  const supabase = getSupabase();
  const now = useNow();
  const [queue, setQueue] = useState<Queue>("open");
  const [items, setItems] = useState<Report[] | null>(null);
  const [total, setTotal] = useState(0);
  const [linked, setLinked] = useState<Report | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(
    async (q: Queue, offset: number) => {
      const { data, error } = await supabase.rpc("admin_list_reports", { p_status: q, p_limit: PAGE, p_offset: offset });
      if (error) {
        setError(errorNode(error));
        return;
      }
      setError(null);
      const page = data as unknown as { total: number; items: Report[] };
      setTotal(page.total);
      setItems((prev) => (offset === 0 ? page.items : [...(prev ?? []), ...page.items]));
    },
    [supabase],
  );

  useEffect(() => {
    // Data load on queue change / after an action; setState happens after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(queue, 0);
  }, [queue, version, load]);

  // ?report=<id> (link in the alert email): show that report first, whatever its status.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("report");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    supabase.rpc("admin_get_report", { p_report_id: id }).then(({ data, error }) => {
      if (error) setError(errorNode(error));
      else setLinked(data as unknown as Report);
    });
  }, [supabase, version]);

  const done = (msg: string) => {
    onNotice(msg);
    setVersion((v) => v + 1);
  };

  const list = (items ?? []).filter((r) => r.id !== linked?.id);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Report status">
        {(["open", "actioned", "dismissed"] as const).map((q) => (
          <button
            key={q}
            type="button"
            role="tab"
            aria-selected={queue === q}
            data-testid={`admin-queue-${q}`}
            onClick={() => {
              setItems(null);
              setQueue(q);
            }}
            className={cx(
              "rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors",
              queue === q ? "bg-fg text-app" : "bg-field text-muted hover:text-fg",
            )}
          >
            {A.queue[q]}
            {queue === q && items ? ` (${total})` : ""}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setVersion((v) => v + 1)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-muted hover:text-fg"
        >
          <RefreshCw size={14} aria-hidden /> {A.refresh}
        </button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {linked && <ReportCard key={`linked-${linked.id}-${version}`} r={linked} now={now} linked onDone={done} />}

      {items === null ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted">
          <Spinner /> {A.loading}
        </div>
      ) : list.length === 0 && !linked ? (
        <p className="py-8 text-center text-sm text-muted" data-testid="admin-empty">
          {A.empty[queue]}
        </p>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <ReportCard key={`${r.id}-${version}`} r={r} now={now} onDone={done} />
          ))}
        </div>
      )}

      {items && items.length < total && (
        <button type="button" className="btn-calm-ghost w-full" onClick={() => void load(queue, items.length)}>
          {A.loadMore}
        </button>
      )}
    </section>
  );
}

function UsersPanel({ onNotice }: { onNotice: (m: string) => void }) {
  const supabase = getSupabase();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  const [pending, setPending] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc("admin_find_users", { p_query: q, p_limit: 50 });
      if (error) setError(errorNode(error));
      else {
        setError(null);
        setUsers(data as unknown as AdminUser[]);
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [query, version, supabase]);

  const lift = async () => {
    if (!pending) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_unsuspend", { p_user_id: pending.id });
    setBusy(false);
    setPending(null);
    if (error) setError(errorNode(error));
    else {
      onNotice(A.done.unsuspend);
      setVersion((v) => v + 1);
    }
  };

  return (
    <section className="space-y-4">
      <label className="relative block">
        <span className="sr-only">{A.users.search}</span>
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          data-testid="admin-user-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={A.users.search}
          className="min-h-11 w-full rounded-field border-2 border-transparent bg-field pl-9 pr-4 text-[15px] text-fg outline-none placeholder:text-muted focus:border-grape"
        />
      </label>
      {error && <Banner kind="error">{error}</Banner>}
      {query.trim().length < 2 ? (
        <p className="text-sm text-muted">{A.users.hint}</p>
      ) : users && users.length === 0 ? (
        <p className="text-sm text-muted">{A.users.none}</p>
      ) : users ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-semibold">{A.users.name}</th>
                <th className="px-3 py-2 font-semibold">{A.users.status}</th>
                <th className="px-3 py-2 font-semibold">{A.users.reports}</th>
                <th className="px-3 py-2 font-semibold">{A.users.bubbles}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} data-testid="admin-user-row" data-user-id={u.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-semibold">{u.name || A.deletedUser}</span>
                    <span className="block font-mono text-[11px] text-muted">{u.id}</span>
                  </td>
                  <td className="px-3 py-2" data-testid="admin-user-status">
                    {u.status === "active" ? (
                      <Pill className="bg-mint/15 text-mint-ink">{STATUS_LABEL.active}</Pill>
                    ) : (
                      <UserStatus status={u.status} until={u.status_until} ended={u.status === "suspended" && u.active} />
                    )}
                    {u.status_reason && u.status !== "active" && (
                      <span className="ml-1 text-xs text-muted">{REASON_LABEL[u.status_reason] ?? u.status_reason}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {u.open_reports_30d} / {u.reports_total}
                  </td>
                  <td className="px-3 py-2">{u.bubbles}</td>
                  <td className="px-3 py-2 text-right">
                    {u.status !== "active" && (
                      <button
                        type="button"
                        data-testid="admin-unsuspend"
                        className="inline-flex min-h-9 items-center rounded-field bg-field px-3 text-sm font-bold text-fg hover:opacity-80"
                        onClick={() => setPending(u)}
                      >
                        {u.status === "banned" ? A.users.unban : A.users.unsuspend}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> {A.loading}
        </div>
      )}
      <Modal calm open={!!pending} onClose={() => !busy && setPending(null)} title={A.confirm.title}>
        {pending && (
          <div className="space-y-4" data-testid="admin-confirm">
            <p className="text-[15px]">{A.confirm.unsuspend(pending.name || pending.id)}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-calm-ghost" onClick={() => setPending(null)} disabled={busy}>
                {A.confirm.cancel}
              </button>
              <button type="button" className="btn-calm" onClick={lift} disabled={busy} data-testid="admin-confirm-go">
                {busy ? A.confirm.working : A.confirm.go}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

export default function AdminView() {
  const [tab, setTab] = useState<"reports" | "users">("reports");
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <main data-calm className="mx-auto min-h-dvh max-w-4xl space-y-5 px-4 py-6 sm:py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-black tracking-tight">{A.heading}</h1>
        <p className="text-sm text-muted">{A.sla}</p>
      </header>
      <nav className="flex gap-1 border-b border-line" role="tablist" aria-label="Moderation">
        {(["reports", "users"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            data-testid={`admin-tab-${t}`}
            onClick={() => setTab(t)}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-[15px] font-bold transition-colors",
              tab === t ? "border-grape text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t === "reports" ? A.tabReports : A.tabUsers}
          </button>
        ))}
      </nav>
      {notice && (
        <Banner kind="ok" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {tab === "reports" ? <ReportsPanel onNotice={setNotice} /> : <UsersPanel onNotice={setNotice} />}
    </main>
  );
}
