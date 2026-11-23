"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Download, FileText, LogOut, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { useBoolaa } from "@/components/boolaa-provider";
import { Avatar, ErrorText, Modal, NewTabHint } from "@/components/ui";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { LocalePicker } from "@/i18n/locale-picker";
import { hardNavigate, removeImage, uploadImage } from "@/lib/utils";
import { unregisterPush } from "@/lib/push";
import { AccountSecurity } from "@/components/account-security";
import { DeleteAccountPanel } from "@/components/delete-account";
import { DataExportPanel } from "@/components/data-export";
import { forgetOfflineData } from "@/lib/outbox";

export function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("profile");
  return (
    <Modal open={open} onClose={onClose} title={t("title")}>
      {open && <ProfileForm onClose={onClose} />}
    </Modal>
  );
}

function ProfileForm({ onClose }: { onClose: () => void }) {
  const { supabase, userId, email, profile, refreshProfile } = useBoolaa();
  const [name, setName] = useState(profile?.name ?? "");
  const t = useTranslations();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function changeAvatar(file: File) {
    setBusy(true);
    setError(null);
    try {
      const url = await uploadImage(supabase, "avatars", userId, file);
      const { error } = await supabase.from("users").update({ avatar: url }).eq("id", userId);
      if (error) throw error;
      await removeImage(supabase, "avatars", profile?.avatar);
      await refreshProfile();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("users").update({ name: name.trim() }).eq("id", userId);
    setBusy(false);
    if (error) return setError(errorText(error));
    await refreshProfile();
    onClose();
  }

  async function signOut() {
    await unregisterPush(supabase); // docs/push-notifications.md §8: unregister, then sign out
    forgetOfflineData(); // no cached view or queued message stays behind
    await supabase.auth.signOut();
    hardNavigate("/login");
  }

  return (
    <>
    <form onSubmit={save} className="space-y-5">
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative rounded-full"
          aria-label={t("profile.changeAvatar")}
          disabled={busy}
        >
          <span className="block rounded-full p-[3px]" style={{ background: "conic-gradient(var(--grape), var(--pink), var(--sunny), var(--mint), var(--sky), var(--grape))" }}>
            <Avatar name={profile?.name} id={profile?.id} src={profile?.avatar} size={112} />
          </span>
          <span className="hue-grape absolute bottom-0 right-0 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-hue-grad text-white shadow-glow ring-2 ring-app">
            <Camera size={16} />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label={t("profile.avatarFile")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void changeAvatar(f);
            e.target.value = "";
          }}
        />
        <span className="text-sm text-muted">{profile?.avatar ? t("profile.replacePhoto") : t("profile.uploadPhoto")}</span>
      </div>
      <div>
        <label className="label" htmlFor="profile-name">
          {t("auth.name")}
        </label>
        <input
          id="profile-name"
          className="input"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="profile-email">
          {t("auth.email")}
        </label>
        <input id="profile-email" className="input opacity-70" value={email} readOnly />
      </div>
      <LocalePicker />
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="submit" className="btn-primary min-h-[54px] flex-1 text-[17px]" disabled={busy || !name.trim()}>
          {t("common.save")}
        </button>
        <button type="button" onClick={signOut} className="btn-danger flex-1">
          <LogOut size={18} /> {t("profile.signOut")}
        </button>
      </div>
    </form>
    <AccountSecurity />
    <BlockedUsers />
    <AccountSection />
    </>
  );
}

type BlockedRow = { blocked_id: string; user: { id: string; name: string; avatar: string | null } | null };

/** People I blocked, with Unblock. Names are only visible while we still share a bubble (RLS). */
function BlockedUsers() {
  const { supabase, userId, blocked, unblock } = useBoolaa();
  const t = useTranslations();
  const errorText = useErrorText();
  const [rows, setRows] = useState<BlockedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("blocks")
      .select("blocked_id, user:users!blocked_id(id, name, avatar)")
      .eq("blocker_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(errorText(error));
        setRows(data ?? []);
      });
  }, [supabase, userId, errorText]);

  const shown = (rows ?? []).filter((r) => blocked.has(r.blocked_id));
  return (
    <section className="mt-6 border-t border-line pt-5" aria-labelledby="blocked-title" data-testid="blocked-users">
      <h3 id="blocked-title" className="mb-2 font-semibold">
        {t("safety.blockedUsers")}
      </h3>
      {rows !== null && shown.length === 0 && <p className="text-sm text-muted">{t("safety.noBlocked")}</p>}
      <ul className="space-y-2">
        {shown.map((r) => (
          <li key={r.blocked_id} className="flex items-center gap-3" data-testid="blocked-user">
            <Avatar name={r.user?.name} id={r.user?.id} src={r.user?.avatar} size={32} decorative />
            <span className="min-w-0 flex-1 truncate">{r.user?.name ?? t("common.someone")}</span>
            <button
              type="button"
              className="chip bg-brand/15 text-brand-ink hover:bg-brand/20"
              onClick={() => unblock(r.blocked_id).catch((e) => setError(errorText(e)))}
              data-testid="unblock"
            >
              <Undo2 size={15} /> {t("safety.unblock")}
            </button>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

/** Legal links, data export (GDPR access) and account deletion (App Store 5.1.1(v)). */
function AccountSection() {
  const { supabase, userId } = useBoolaa();
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);

  return (
    <section className="mt-6 space-y-3 border-t border-line pt-5">
      <div className="flex flex-wrap gap-2">
        <Link href="/privacy" className="chip bg-brand/15 text-brand-ink hover:bg-brand/20" target="_blank">
          <ShieldCheck size={15} /> {t("legal.privacy")}
          <NewTabHint />
        </Link>
        <Link href="/terms" className="chip bg-brand/15 text-brand-ink hover:bg-brand/20" target="_blank">
          <FileText size={15} /> {t("legal.terms")}
          <NewTabHint />
        </Link>
      </div>
      {!exporting ? (
        <button type="button" onClick={() => setExporting(true)} className="btn-ghost w-full" data-testid="export-data">
          <Download size={18} /> {t("profile.exportData")}
        </button>
      ) : (
        <DataExportPanel supabase={supabase} onClose={() => setExporting(false)} />
      )}
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="btn-danger w-full" data-testid="delete-account">
          <Trash2 size={18} /> {t("profile.deleteAccount")}
        </button>
      ) : (
        <DeleteAccountPanel supabase={supabase} userId={userId} onCancel={() => setConfirming(false)} />
      )}
    </section>
  );
}
