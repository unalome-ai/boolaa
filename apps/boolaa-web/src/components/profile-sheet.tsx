"use client";

import { useRef, useState, type FormEvent } from "react";
import { Camera, LogOut } from "lucide-react";
import { useBoolaa } from "@/components/boolaa-provider";
import { Avatar, ErrorText, Modal } from "@/components/ui";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { LocalePicker } from "@/i18n/locale-picker";
import { hardNavigate, removeImage, uploadImage } from "@/lib/utils";

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
    await supabase.auth.signOut();
    hardNavigate("/login");
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative rounded-full"
          aria-label={t("profile.changeAvatar")}
          disabled={busy}
        >
          <Avatar name={profile?.name} src={profile?.avatar} size={96} />
          <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white shadow-soft">
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
        <button type="submit" className="btn-primary flex-1" disabled={busy || !name.trim()}>
          {t("common.save")}
        </button>
        <button type="button" onClick={signOut} className="btn-danger flex-1">
          <LogOut size={18} /> {t("profile.signOut")}
        </button>
      </div>
    </form>
  );
}
