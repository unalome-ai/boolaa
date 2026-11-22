"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CodeInput, ResendButton, useCooldown } from "@/components/code-input";
import { ErrorText } from "@/components/ui";
import { useErrorText } from "@/i18n/errors";
import { RESEND_COOLDOWN_S, markSent, sendSensitiveCode, verifySensitiveCode } from "@/lib/device";
import type { BoolaaClient } from "@/lib/supabase/client";
import { hardNavigate, signOutTarget } from "@/lib/utils";

const BUCKETS = ["avatars", "food.images", "market.images", "chat.images"] as const;

/**
 * Account deletion (docs/auth-security.md §2, "Flow: delete account"): warning + typed word, then
 * an emailed `sensitive_action` code (always, even before enforcement), then the user's storage
 * objects, then delete_my_account() in the same session within 10 minutes, then local sign-out.
 * Flat and still on purpose (design-system 6.9: calm when it matters).
 */
export function DeleteAccountPanel({ supabase, userId, onCancel }: { supabase: BoolaaClient; userId: string; onCancel: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const errorText = useErrorText();
  const [step, setStep] = useState<"warn" | "code">("warn");
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const cooldown = useCooldown();
  const word = t("profile.deleteWord");
  const matches = typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase();

  const fail = (e: unknown) => {
    setError(errorText(e));
    setShake((n) => n + 1);
    setBusy(false);
  };

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await sendSensitiveCode(supabase, "delete_account", locale);
      markSent("sensitive_action");
      cooldown.start(RESEND_COOLDOWN_S);
      setCode("");
      setStep("code");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  }

  async function verifyAndDelete(value: string) {
    setBusy(true);
    setError(null);
    try {
      await verifySensitiveCode(supabase, value);
    } catch (e) {
      setCode("");
      return fail(e);
    }
    try {
      // Storage objects can't be deleted from SQL: remove everything under <uid>/ first (best effort).
      for (const bucket of BUCKETS) {
        for (;;) {
          const { data } = await supabase.storage.from(bucket).list(userId, { limit: 100 });
          const paths = (data ?? []).filter((f) => f.id).map((f) => `${userId}/${f.name}`);
          if (paths.length === 0) break;
          const { data: removed, error } = await supabase.storage.from(bucket).remove(paths);
          if (error || !removed?.length) break; // never spin if nothing could be removed
        }
      }
      // Set before the RPC: the cascade deletes this user's memberships, and the provider's live
      // membership handler must not race us to /onboarding (which would bounce to /login).
      signOutTarget.leaving = true;
      signOutTarget.path = "/";
      const { error } = await supabase.rpc("delete_my_account");
      if (error) throw error;
      await supabase.auth.signOut({ scope: "local" });
      hardNavigate("/");
    } catch (e) {
      signOutTarget.leaving = false;
      signOutTarget.path = "/login";
      fail(e);
    }
  }

  return (
    <div className="space-y-3 rounded-field border border-danger/30 bg-danger/5 p-4" data-testid="delete-panel">
      <p className="font-display font-extrabold text-danger-ink">{t("profile.deleteTitle")}</p>
      {step === "warn" ? (
        <>
          <p className="text-sm text-muted">{t("profile.deleteBody")}</p>
          <label className="label" htmlFor="delete-confirm-word">
            {t("profile.deleteTypeToConfirm", { word })}
          </label>
          <input
            id="delete-confirm-word"
            className="input"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            data-testid="delete-word"
          />
          <p className="text-sm text-muted">{t("profile.deleteCodeNote")}</p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted" data-testid="delete-code-sent">
            {t("profile.codeSentBody")}
          </p>
          <CodeInput value={code} onChange={setCode} onComplete={verifyAndDelete} disabled={busy} invalid={!!error} id="delete-code" />
          <p className="text-sm">
            <ResendButton left={cooldown.left} busy={busy} onClick={sendCode} />
          </p>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-3">
        <button type="button" className="btn-calm-ghost flex-1" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
        {step === "warn" ? (
          <button
            key={shake}
            type="button"
            className="btn-destructive flex-1"
            disabled={!matches || busy}
            onClick={sendCode}
            data-testid="delete-confirm"
          >
            {busy ? t("auth.sendingCode") : t("profile.deleteConfirm")}
          </button>
        ) : (
          <button
            key={shake}
            type="button"
            className="btn-destructive flex-1"
            disabled={code.length !== 6 || busy}
            onClick={() => verifyAndDelete(code)}
            data-testid="delete-final"
          >
            {busy ? t("profile.deleting") : t("profile.deleteConfirm")}
          </button>
        )}
      </div>
    </div>
  );
}
