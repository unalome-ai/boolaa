"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, Clock, Copy, Crown, ImagePlus, Link2, LogOut, RefreshCw, Settings2, Share2, Shield, ShieldOff, Trash2, UserMinus, X } from "lucide-react";
import { SafetyMenu } from "@/components/safety";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { Avatar, BubblePhoto, ErrorText, Modal, PageLoader, SectionTitle, EmptyNote } from "@/components/ui";
import { removeImage, uploadImage } from "@/lib/utils";
import { FeatureBadge } from "@/components/orb";
import { liveChannel } from "@/lib/realtime";
import { AUTHOR, type JoinRequest, type Member } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { inviteUrl } from "@/lib/invite";
import { canManage, canRemove, roleOf } from "@/lib/roles";
import { BubbleMute, NotificationSettings } from "@/components/notification-settings";
import { ThemePicker } from "@/components/theme-picker";
import { LoadError, StaleNotice, useResilientLoad } from "@/components/offline";
import { useConnectivity } from "@/lib/connectivity";
import { readCache, writeCache } from "@/lib/offline";

type MembersCache = { members: Member[]; requests: JoinRequest[] };

export default function SettingsPage() {
  const { supabase, userId, refreshBubbles } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tn = useTranslations("notifications");
  const ta = useTranslations("appearance");
  const errorText = useErrorText();
  const fmt = useFormat();
  // The last view of members and requests shows at once (also offline); the load refreshes it.
  const cacheKey = `members.${bubble.id}`;
  const [members, setMembers] = useState<Member[] | null>(() => readCache<MembersCache>(cacheKey)?.members ?? null);
  const [requests, setRequests] = useState<JoinRequest[]>(() => readCache<MembersCache>(cacheKey)?.requests ?? []);
  const { generation } = useConnectivity();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateBusy, setRotateBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [transferring, setTransferring] = useState<Member | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [live, setLive] = useState(false);
  const requestIds = useRef<Set<string>>(new Set(requests.map((x) => x.id)));
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const [m, r] = await Promise.all([
      supabase
        .from("bubble_members")
        .select(`*, user:users!user_id(${AUTHOR})`)
        .eq("bubble_id", bubble.id)
        .eq("approved", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("join_requests")
        .select(`*, user:users!user_id(${AUTHOR})`)
        .eq("bubble_id", bubble.id)
        .order("created_at", { ascending: true }),
    ]);
    if (seq !== loadSeq.current) return true; // a newer load started meanwhile: don't overwrite it with older data
    if (m.error || r.error) return false; // keeps what is on screen; LoadError / StaleNotice offer Try again
    setMembers(m.data ?? []);
    setRequests(r.data ?? []);
    requestIds.current = new Set((r.data ?? []).map((x) => x.id));
    writeCache<MembersCache>(cacheKey, { members: m.data ?? [], requests: r.data ?? [] });
    return true;
  }, [supabase, bubble.id, cacheKey]);
  const sync = useResilientLoad(load);

  useEffect(() => {
    // Live lists: requests arriving/votes/admissions and members joining/leaving/changing role.
    // DELETE events can't be filtered server-side (the old row only has the primary key).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 150); // one reload for a burst (admission = insert + delete)
    };
    const inBubble = `bubble_id=eq.${bubble.id}`;
    const unsubscribe = liveChannel(
      supabase,
      `settings:${bubble.id}`,
      (ch) =>
        ch
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "join_requests", filter: inBubble }, reload)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "join_requests", filter: inBubble }, reload)
          .on("postgres_changes", { event: "DELETE", schema: "public", table: "join_requests" }, (p) => {
            if (requestIds.current.has((p.old as { id?: string }).id ?? "")) reload();
          })
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "bubble_members", filter: inBubble }, reload)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bubble_members", filter: inBubble }, reload)
          .on("postgres_changes", { event: "DELETE", schema: "public", table: "bubble_members" }, (p) => {
            if ((p.old as { bubble_id?: string }).bubble_id === bubble.id) reload();
          }),
      (ready) => {
        if (ready) void load().then(() => setLive(true)); // catch up on changes made before streaming started
        else setLive(false);
      },
    );
    window.addEventListener("focus", reload); // fallback if an event was missed
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", reload);
      unsubscribe();
    };
    // `generation`: resubscribe after a reconnect (then reload once live).
  }, [load, supabase, bubble.id, generation]);

  const memberCount = members?.length ?? 0;
  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  // Roles can change at any time (transfer, promotion, hand-over when the owner leaves), so read
  // mine from the live members list (docs/boolaa-spec.md, "Roles"). The server enforces all of it.
  const myRole = members ? roleOf(members.find((m) => m.user_id === userId)?.role) : roleOf(bubble.role);
  const isOwner = myRole === "owner";
  const manager = canManage(myRole);
  const full = memberCount >= bubble.max_size;
  const needed = Math.floor(memberCount / 2) + 1; // strict majority, as in try_admit_join_request
  // Only votes from current members count (votes of people who left are discarded).
  const votes = (r: JoinRequest) => r.approver_ids.filter((id) => memberIds.has(id)).length;

  async function copyCode() {
    await navigator.clipboard?.writeText(bubble.invite_code).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function share() {
    const text = t("shareText", { bubble: bubble.name, code: bubble.invite_code });
    if (navigator.share) {
      await navigator.share({ title: t("shareTitle"), text }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(text).catch(() => undefined);
      setNotice(t("inviteCopied"));
      setTimeout(() => setNotice(null), 2000);
    }
  }

  const link = inviteUrl(bubble.invite_code);

  async function copyLink() {
    await navigator.clipboard?.writeText(link).catch(() => undefined);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }

  async function shareLink() {
    const text = t("shareLinkText", { bubble: bubble.name, url: link });
    if (navigator.share) {
      await navigator.share({ title: t("shareTitle"), text }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(text).catch(() => undefined);
      setNotice(t("inviteCopied"));
      setTimeout(() => setNotice(null), 2000);
    }
  }

  /** Owner or admin: a new code; the old code, link and QR code stop working at once. */
  async function rotate() {
    setRotateBusy(true);
    setError(null);
    const { error } = await supabase.rpc("rotate_invite_code", { p_bubble_id: bubble.id });
    setRotateBusy(false);
    setRotating(false);
    if (error) return setError(errorText(error));
    await refreshBubbles();
    setNotice(t("rotated"));
    setTimeout(() => setNotice(null), 2500);
  }

  async function approve(r: JoinRequest) {
    setError(null);
    const { data, error } = await supabase.rpc("approve_join_request", { p_request_id: r.id });
    if (error) return setError(errorText(error));
    const waiting = !data && full && votes(r) + 1 >= needed;
    setNotice(data ? t("joined", { name: r.user?.name ?? tc("someone") }) : waiting ? t("waitingForSpot") : t("approvalRecorded"));
    setTimeout(() => setNotice(null), 2500);
    void load();
  }

  async function reject(r: JoinRequest) {
    setError(null);
    const { error } = await supabase.rpc("reject_join_request", { p_request_id: r.id });
    if (error) return setError(errorText(error));
    void load();
  }

  async function remove(m: Member) {
    setError(null);
    const { error } = await supabase.rpc("remove_member", { p_bubble_id: bubble.id, p_user_id: m.user_id });
    setRemoving(null);
    if (error) return setError(errorText(error));
    setNotice(t("removed", { name: m.user?.name ?? tc("someone") }));
    setTimeout(() => setNotice(null), 2500);
    void load();
  }

  /** Owner only: promote a member to admin or demote an admin. */
  async function setRole(m: Member, role: "admin" | "member") {
    setError(null);
    setRoleBusy(true);
    const { error } = await supabase.rpc("set_member_role", { p_bubble_id: bubble.id, p_user_id: m.user_id, p_role: role });
    setRoleBusy(false);
    if (error) return setError(errorText(error));
    const name = m.user?.name ?? tc("someone");
    setNotice(role === "admin" ? t("madeAdmin", { name }) : t("removedAdmin", { name }));
    setTimeout(() => setNotice(null), 2500);
    void load();
  }

  /** Owner only: hand the bubble to another member; I become an admin. */
  async function transfer(m: Member) {
    setError(null);
    setRoleBusy(true);
    const { error } = await supabase.rpc("transfer_ownership", { p_bubble_id: bubble.id, p_new_owner: m.user_id });
    setRoleBusy(false);
    setTransferring(null);
    if (error) return setError(errorText(error));
    setNotice(t("transferred", { name: m.user?.name ?? tc("someone") }));
    setTimeout(() => setNotice(null), 2500);
    void load();
    void refreshBubbles(); // my role in the bubble list
  }

  async function leave() {
    const { error } = await supabase.from("bubble_members").delete().eq("bubble_id", bubble.id).eq("user_id", userId);
    if (error) return setError(errorText(error));
    setLeaving(false);
    await refreshBubbles(); // redirects to /onboarding when that was the last bubble
  }

  return (
    <div className="space-y-2" data-testid="settings" data-live={live}>
      <ErrorText>{error}</ErrorText>
      <StaleNotice show={sync.failed} onRetry={sync.retry} />
      {notice && (
        <p role="status" data-testid="notice" className="hue-mint anim-pop-soft rounded-field bg-hue-wash px-4 py-2.5 text-sm font-semibold text-hue-ink">
          {notice}
        </p>
      )}

      <SectionTitle hue="indigo">{t("bubble")}</SectionTitle>
      <BubbleDetails key={bubble.id} canEdit={manager} />

      {/* Invite "ticket" (6.3) */}
      <div
        className="hue-grape mt-7 flex flex-wrap items-center gap-3 rounded-card border-[1.5px] border-dashed bg-hue-wash p-4 sm:p-5"
        style={{ borderColor: "color-mix(in srgb, var(--h-ink) 45%, transparent)" }}
      >
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <h2 className="font-display text-xs font-black uppercase tracking-wide text-hue-ink">{t("inviteCode")}</h2>
          <code className="block font-display text-[28px] font-black tracking-[3px] text-hue-ink" data-testid="invite-code">
            {bubble.invite_code}
          </code>
        </div>
        <button type="button" onClick={copyCode} className={`btn h-11 px-4 text-sm ${copied ? "hue-mint fill-hue" : "bg-brand/15 text-brand-ink"}`}>
          {copied ? <Check size={16} strokeWidth={3} className="anim-pop" /> : <Copy size={16} strokeWidth={2.6} />} {copied ? t("copied") : t("copy")}
        </button>
        <button type="button" onClick={share} className="btn-primary h-11 px-4 text-sm">
          <Share2 size={16} strokeWidth={2.6} /> {t("share")}
        </button>
        {/* Invite link: https://boolaa.ro/join/CODE (opens the app when installed). */}
        <div className="min-w-0 basis-full border-t border-dashed pt-3" style={{ borderColor: "color-mix(in srgb, var(--h-ink) 30%, transparent)" }}>
          <h3 className="font-display text-xs font-black uppercase tracking-wide text-hue-ink">{t("inviteLink")}</h3>
          <p className="truncate font-mono text-sm text-hue-ink" data-testid="invite-link">
            {link}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={copyLink} className={`btn h-10 px-3.5 text-sm ${linkCopied ? "hue-mint fill-hue" : "bg-brand/15 text-brand-ink"}`} data-testid="copy-invite-link">
              {linkCopied ? <Check size={16} strokeWidth={3} className="anim-pop" /> : <Link2 size={16} strokeWidth={2.6} />} {linkCopied ? t("copied") : t("copyLink")}
            </button>
            <button type="button" onClick={shareLink} className="btn h-10 bg-brand/15 px-3.5 text-sm text-brand-ink" data-testid="share-invite-link">
              <Share2 size={16} strokeWidth={2.6} /> {t("shareLink")}
            </button>
            {manager && (
              <button type="button" onClick={() => setRotating(true)} className="btn h-10 bg-brand/15 px-3.5 text-sm text-brand-ink" data-testid="rotate-invite">
                <RefreshCw size={16} strokeWidth={2.6} /> {t("rotateCode")}
              </button>
            )}
          </div>
        </div>
      </div>

      <SectionTitle hue="indigo" count={requests.length > 0 ? requests.length : undefined}>
        {t("pendingRequests")}
      </SectionTitle>
      {requests.length === 0 ? (
        <EmptyNote hue="indigo">{t("noRequests")}</EmptyNote>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const approved = r.approver_ids.includes(userId);
            const count = votes(r);
            const waiting = full && count >= needed;
            return (
              <li key={r.id} className="card flex flex-wrap items-center gap-3 p-4" data-testid="join-request">
                <Avatar name={r.user?.name} id={r.user_id} src={r.user?.avatar} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.user?.name ?? tc("someone")}</p>
                  <p className="text-sm text-muted">
                    <span data-testid="approvals-progress">
                      {t("approvalsProgress", { count, needed })}
                    </span>{" "}
                    · {fmt.relative(r.created_at)}
                  </p>
                  {waiting && (
                    <p className="hue-sunny mt-1.5 inline-flex items-center gap-1 rounded-full bg-hue-wash px-2.5 py-0.5 font-display text-sm font-bold text-hue-ink" data-testid="waiting-spot">
                      <Clock size={14} /> {t("waitingForSpot")}
                    </p>
                  )}
                </div>
                <div className="flex w-full justify-end gap-2 sm:w-auto">
                  {approved ? (
                    <span className="chip hue-mint bg-hue-wash text-hue-ink">
                      <Check size={15} /> {t("youApproved")}
                    </span>
                  ) : (
                    <button type="button" onClick={() => approve(r)} className="btn-primary hue-mint px-4 py-2 text-sm" data-testid="approve">
                      <Check size={16} /> {t("approve")}
                    </button>
                  )}
                  <button type="button" onClick={() => reject(r)} className="btn-danger px-4 py-2 text-sm">
                    <X size={16} /> {t("reject")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <SectionTitle hue="indigo">
        {t("members")}{" "}
        <span className="font-sans text-base font-medium text-muted" data-testid="member-count">
          {members ? t("memberCount", { count: memberCount, max: bubble.max_size }) : ""}
        </span>
      </SectionTitle>
      {members === null ? (
        sync.failed ? (
          <LoadError onRetry={sync.retry} />
        ) : (
          <PageLoader />
        )
      ) : (
        <ul className="card divide-y divide-line">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-4 py-3" data-testid="member" data-user-id={m.user_id} data-role={m.role}>
              <Avatar name={m.user?.name} id={m.user_id} src={m.user?.avatar} size={40} />
              <span className="flex-1 font-medium">
                {m.user?.name ?? tc("someone")}
                {m.user_id === userId && <span className="ml-1 text-muted">{tc("youSuffix")}</span>}
              </span>
              {m.role === "owner" && (
                <span className="hue-sunny inline-flex h-7 items-center gap-1 rounded-full bg-hue-grad px-3 font-display text-xs font-black text-onfill shadow-glow" data-testid="owner-badge">
                  <Crown size={14} strokeWidth={2.6} /> {t("owner")}
                </span>
              )}
              {m.role === "admin" && (
                <span className="hue-sky inline-flex h-7 items-center gap-1 rounded-full bg-hue-wash px-3 font-display text-xs font-black text-hue-ink" data-testid="admin-badge">
                  <Shield size={14} strokeWidth={2.6} /> {t("admin")}
                </span>
              )}
              <SafetyMenu type="user" id={m.user_id} author={{ id: m.user_id, name: m.user?.name }} />
              {isOwner && m.user_id !== userId && (
                <RoleMenu
                  member={m}
                  busy={roleBusy}
                  onSetRole={(role) => void setRole(m, role)}
                  onTransfer={() => setTransferring(m)}
                />
              )}
              {canRemove(myRole, roleOf(m.role)) && m.user_id !== userId && (
                <button
                  type="button"
                  onClick={() => setRemoving(m)}
                  aria-label={t("removeMemberNamed", { name: m.user?.name ?? tc("someone") })}
                  title={t("removeMember")}
                  className="chip h-8 bg-danger/10 px-3 text-danger-ink hover:bg-danger/15"
                  data-testid="remove-member"
                >
                  <UserMinus size={15} /> <span className="hidden sm:inline">{t("removeMember")}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <SectionTitle hue="indigo">{tn("title")}</SectionTitle>
      <div className="space-y-3" id="notifications">
        <BubbleMute key={bubble.id} />
        <NotificationSettings />
      </div>

      <SectionTitle hue="indigo">{ta("title")}</SectionTitle>
      <div id="appearance">
        <ThemePicker />
      </div>

      <SectionTitle>{t("more")}</SectionTitle>
      <Link href="/links" className="card press flex min-h-14 items-center gap-3 rounded-[20px] px-4 py-2.5">
        <FeatureBadge hue="sky" size={34}>
          <Link2 size={18} strokeWidth={2.6} />
        </FeatureBadge>
        <span className="flex-1 font-medium">{t("sharedLinks")}</span>
        <ChevronRight size={18} className="text-muted" />
      </Link>
      <button type="button" onClick={() => setLeaving(true)} className="btn-danger mt-4 w-full" data-testid="leave-bubble">
        <LogOut size={18} /> {t("leave")}
      </button>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={t("removeTitle")}>
        <p className="mb-5 text-muted">
          {t.rich("removeBody", {
            name: removing?.user?.name ?? tc("someone"),
            bubble: bubble.name,
            strong: (chunks) => <strong className="text-fg">{chunks}</strong>,
          })}
        </p>
        <div className="flex gap-3">
          <button type="button" onClick={() => setRemoving(null)} className="btn-ghost flex-1">
            {tc("cancel")}
          </button>
          <button
            type="button"
            onClick={() => removing && remove(removing)}
            className="btn-destructive flex-1"
            data-testid="remove-confirm"
          >
            {t("removeMember")}
          </button>
        </div>
      </Modal>

      <Modal open={!!transferring} onClose={() => setTransferring(null)} title={t("transferTitle")}>
        <p className="mb-5 text-muted" data-testid="transfer-body">
          {t.rich("transferBody", {
            name: transferring?.user?.name ?? tc("someone"),
            bubble: bubble.name,
            strong: (chunks) => <strong className="text-fg">{chunks}</strong>,
          })}
        </p>
        <div className="flex gap-3">
          <button type="button" onClick={() => setTransferring(null)} className="btn-ghost flex-1">
            {tc("cancel")}
          </button>
          <button
            type="button"
            onClick={() => transferring && transfer(transferring)}
            disabled={roleBusy}
            className="btn-destructive flex-1"
            data-testid="transfer-confirm"
          >
            {t("transferOwnership")}
          </button>
        </div>
      </Modal>

      <Modal open={rotating} onClose={() => setRotating(false)} title={t("rotateTitle")}>
        <p className="mb-5 text-muted">{t("rotateBody")}</p>
        <div className="flex gap-3">
          <button type="button" onClick={() => setRotating(false)} className="btn-ghost flex-1">
            {tc("cancel")}
          </button>
          <button type="button" onClick={rotate} disabled={rotateBusy} className="btn-primary flex-1" data-testid="rotate-confirm">
            {t("rotateConfirm")}
          </button>
        </div>
      </Modal>

      <Modal open={leaving} onClose={() => setLeaving(false)} title={t("leaveTitle")}>
        <p className="mb-5 text-muted">
          {t.rich("leaveBody", {
            bubble: bubble.name,
            strong: (chunks) => <strong className="text-fg">{chunks}</strong>,
          })}
        </p>
        <div className="flex gap-3">
          <button type="button" onClick={() => setLeaving(false)} className="btn-ghost flex-1">
            {tc("cancel")}
          </button>
          <button type="button" onClick={leave} className="btn-destructive flex-1" data-testid="leave-confirm">
            {t("leaveConfirm")}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** The owner's per-member menu: make/remove admin and transfer ownership. */
function RoleMenu({
  member,
  busy,
  onSetRole,
  onTransfer,
}: {
  member: Member;
  busy: boolean;
  onSetRole: (role: "admin" | "member") => void;
  onTransfer: () => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isAdmin = member.role === "admin";
  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-field disabled:opacity-50";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t("memberActions", { name: member.user?.name ?? tc("someone") })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-field hover:text-fg"
        data-testid="role-menu"
      >
        <Settings2 size={17} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-[250] mt-1 min-w-56 overflow-hidden rounded-field border border-line bg-card py-1 shadow-float">
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onSetRole(isAdmin ? "member" : "admin");
            }}
            className={item}
            data-testid={isAdmin ? "remove-admin" : "make-admin"}
          >
            {isAdmin ? <ShieldOff size={16} /> : <Shield size={16} />} {isAdmin ? t("removeAdmin") : t("makeAdmin")}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onTransfer();
            }}
            className={item}
            data-testid="transfer-ownership"
          >
            <Crown size={16} /> {t("transferOwnership")}
          </button>
        </div>
      )}
    </div>
  );
}

function BubbleDetails({ canEdit }: { canEdit: boolean }) {
  const { supabase, refreshBubbles } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const [name, setName] = useState(bubble.name);
  const [description, setDescription] = useState(bubble.description ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name.trim() !== bubble.name || description.trim() !== (bubble.description ?? "");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("bubbles")
      .update({ name: name.trim(), description: description.trim() || null })
      .eq("id", bubble.id);
    setBusy(false);
    if (error) return setError(errorText(error));
    await refreshBubbles();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!canEdit) {
    return (
      <div className="card flex items-start gap-4 p-4">
        <BubblePhoto bubble={bubble} size={64} />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{bubble.name}</p>
          <p className="text-muted">{bubble.description || t("noDescription")}</p>
          <p className="mt-2 text-xs text-muted">{t("ownerOnly")}</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="card space-y-3 p-4">
      <BubblePhotoEditor />
      <div>
        <label className="label" htmlFor="bubble-name-edit">
          {t("name")}
        </label>
        <input id="bubble-name-edit" className="input" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="bubble-desc-edit">
          {tc("description")}
        </label>
        <textarea id="bubble-desc-edit" className="input min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-primary" disabled={busy || !dirty || !name.trim()}>
        {saved ? <Check size={16} /> : null}
        {saved ? tc("saved") : busy ? tc("saving") : tc("save")}
      </button>
    </form>
  );
}

/**
 * Owner/admin photo controls (docs/boolaa-spec.md, "Bubble photo"): upload or replace through the shared
 * image pipeline into `bubble.images/<bubble id>/`, point bubbles.logo at it, then delete the previous
 * file (best effort; the hourly sweep removes anything missed). Members get the change live.
 */
function BubblePhotoEditor() {
  const { supabase, refreshBubbles } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations("settings");
  const errorText = useErrorText();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setLogo(file: File | null) {
    setBusy(true);
    setError(null);
    const previous = bubble.logo;
    let uploaded: string | null = null;
    try {
      if (file) uploaded = await uploadImage(supabase, "bubble.images", bubble.id, file);
      const { error } = await supabase.from("bubbles").update({ logo: uploaded }).eq("id", bubble.id);
      if (error) throw error;
      await removeImage(supabase, "bubble.images", previous).catch(() => undefined);
      await refreshBubbles();
    } catch (e) {
      if (uploaded) await removeImage(supabase, "bubble.images", uploaded).catch(() => undefined);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4" data-testid="bubble-photo-editor">
      <BubblePhoto bubble={bubble} size={72} className={busy ? "animate-pulse" : undefined} />
      <div className="min-w-0 flex-1 space-y-2">
        <span className="label mb-0">{t("bubblePhoto")}</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="chip bg-brand/15 text-brand-ink" disabled={busy} onClick={() => inputRef.current?.click()}>
            <ImagePlus size={15} /> {bubble.logo ? t("changeBubblePhoto") : t("addBubblePhoto")}
          </button>
          {bubble.logo && (
            <button type="button" className="chip bg-field text-muted hover:text-fg" disabled={busy} onClick={() => setLogo(null)} data-testid="bubble-photo-remove">
              <Trash2 size={15} /> {t("removeBubblePhoto")}
            </button>
          )}
        </div>
        <p className="text-xs text-muted">{t("bubblePhotoHint")}</p>
        <ErrorText>{error}</ErrorText>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-label={t("bubblePhoto")}
        className="sr-only"
        data-testid="bubble-photo-input"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (f) void setLogo(f);
        }}
      />
    </div>
  );
}
