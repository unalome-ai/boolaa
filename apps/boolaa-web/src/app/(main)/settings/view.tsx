"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, Clock, Copy, Crown, Link2, LogOut, Share2, UserMinus, X } from "lucide-react";
import { SafetyMenu } from "@/components/safety";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { Avatar, ErrorText, Modal, PageLoader, SectionTitle } from "@/components/ui";
import { liveChannel } from "@/lib/realtime";
import { AUTHOR, type JoinRequest, type Member } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";

export default function SettingsPage() {
  const { supabase, userId, refreshBubbles } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const fmt = useFormat();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [live, setLive] = useState(false);
  const requestIds = useRef<Set<string>>(new Set());
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
    if (seq !== loadSeq.current) return; // a newer load started meanwhile: don't overwrite it with older data
    if (m.error || r.error) setError(errorText(m.error ?? r.error));
    setMembers(m.data ?? []);
    setRequests(r.data ?? []);
    requestIds.current = new Set((r.data ?? []).map((x) => x.id));
  }, [supabase, bubble.id, errorText]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
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
  }, [load, supabase, bubble.id]);

  const memberCount = members?.length ?? 0;
  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  // Ownership can move (oldest member inherits it when the owner leaves), so read it from live data.
  const isOwner = members ? members.some((m) => m.user_id === userId && m.role === "owner") : bubble.role === "owner";
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

  async function leave() {
    const { error } = await supabase.from("bubble_members").delete().eq("bubble_id", bubble.id).eq("user_id", userId);
    if (error) return setError(errorText(error));
    setLeaving(false);
    await refreshBubbles(); // redirects to /onboarding when that was the last bubble
  }

  return (
    <div className="space-y-2" data-testid="settings" data-live={live}>
      <ErrorText>{error}</ErrorText>
      {notice && (
        <p role="status" data-testid="notice" className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}

      <SectionTitle>{t("bubble")}</SectionTitle>
      <BubbleDetails key={bubble.id} canEdit={isOwner} />

      <SectionTitle>{t("inviteCode")}</SectionTitle>
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <code className="min-w-0 basis-full font-mono text-2xl font-bold tracking-[0.25em] text-brand sm:basis-auto sm:flex-1" data-testid="invite-code">
          {bubble.invite_code}
        </code>
        <button type="button" onClick={copyCode} className="btn-ghost px-4 py-2 text-sm">
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t("copied") : t("copy")}
        </button>
        <button type="button" onClick={share} className="btn-primary px-4 py-2 text-sm">
          <Share2 size={16} /> {t("share")}
        </button>
      </div>

      <SectionTitle>
        {t("pendingRequests")}
        {requests.length > 0 && (
          <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-sm text-white">{fmt.number(requests.length)}</span>
        )}
      </SectionTitle>
      {requests.length === 0 ? (
        <p className="card px-4 py-5 text-sm text-muted">{t("noRequests")}</p>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => {
            const approved = r.approver_ids.includes(userId);
            const count = votes(r);
            const waiting = full && count >= needed;
            return (
              <li key={r.id} className="card flex flex-wrap items-center gap-3 p-4" data-testid="join-request">
                <Avatar name={r.user?.name} src={r.user?.avatar} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.user?.name ?? tc("someone")}</p>
                  <p className="text-sm text-muted">
                    <span data-testid="approvals-progress">
                      {t("approvalsProgress", { count, needed })}
                    </span>{" "}
                    · {fmt.relative(r.created_at)}
                  </p>
                  {waiting && (
                    <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-amber-700 dark:text-amber-400" data-testid="waiting-spot">
                      <Clock size={14} /> {t("waitingForSpot")}
                    </p>
                  )}
                </div>
                <div className="flex w-full justify-end gap-2 sm:w-auto">
                  {approved ? (
                    <span className="chip bg-brand/10 text-brand">
                      <Check size={15} /> {t("youApproved")}
                    </span>
                  ) : (
                    <button type="button" onClick={() => approve(r)} className="btn-primary px-4 py-2 text-sm" data-testid="approve">
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

      <SectionTitle>
        {t("members")}{" "}
        <span className="text-base font-medium text-muted" data-testid="member-count">
          {members ? t("memberCount", { count: memberCount, max: bubble.max_size }) : ""}
        </span>
      </SectionTitle>
      {members === null ? (
        <PageLoader />
      ) : (
        <ul className="card divide-y divide-line">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-4 py-3" data-testid="member" data-user-id={m.user_id} data-role={m.role}>
              <Avatar name={m.user?.name} src={m.user?.avatar} size={40} />
              <span className="flex-1 font-medium">
                {m.user?.name ?? tc("someone")}
                {m.user_id === userId && <span className="ml-1 text-muted">{tc("youSuffix")}</span>}
              </span>
              {m.role === "owner" && (
                <span className="chip h-7 bg-brand/15 text-brand" data-testid="owner-badge">
                  <Crown size={14} /> {t("owner")}
                </span>
              )}
              <SafetyMenu type="user" id={m.user_id} author={{ id: m.user_id, name: m.user?.name }} />
              {isOwner && m.role !== "owner" && m.user_id !== userId && (
                <button
                  type="button"
                  onClick={() => setRemoving(m)}
                  aria-label={t("removeMemberNamed", { name: m.user?.name ?? tc("someone") })}
                  title={t("removeMember")}
                  className="chip h-8 bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:text-red-400"
                  data-testid="remove-member"
                >
                  <UserMinus size={15} /> <span className="hidden sm:inline">{t("removeMember")}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>{t("more")}</SectionTitle>
      <Link href="/links" className="card flex items-center gap-3 p-4 hover:bg-chip">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/15 text-brand">
          <Link2 size={20} />
        </span>
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
            className="btn flex-1 bg-red-500 text-white hover:bg-red-600"
            data-testid="remove-confirm"
          >
            {t("removeMember")}
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
          <button type="button" onClick={leave} className="btn flex-1 bg-red-500 text-white hover:bg-red-600" data-testid="leave-confirm">
            {t("leaveConfirm")}
          </button>
        </div>
      </Modal>
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
      <div className="card p-4">
        <p className="text-lg font-semibold">{bubble.name}</p>
        <p className="text-muted">{bubble.description || t("noDescription")}</p>
        <p className="mt-2 text-xs text-muted">{t("ownerOnly")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="card space-y-3 p-4">
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
