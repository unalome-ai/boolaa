"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { KeyRound, Laptop, Mail, Smartphone, X } from "lucide-react";
import { useBoolaa } from "@/components/boolaa-provider";
import { CodeInput, ResendButton, useCooldown } from "@/components/code-input";
import { ErrorText } from "@/components/ui";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import { RESEND_COOLDOWN_S, getDeviceId, sendSensitiveCode, sha256Hex, verifySensitiveCode } from "@/lib/device";
import { cx } from "@/lib/utils";

type Step = "idle" | "form" | "code" | "done";

/**
 * Change password: new password → a `sensitive_action` code ("change_password") → updateUser({ password }).
 * The server refuses the change without a fresh code (docs/auth-security.md → Sensitive actions).
 */
function ChangePassword() {
  const { supabase, email } = useBoolaa();
  const t = useTranslations();
  const locale = useLocale();
  const errorText = useErrorText();
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const cooldown = useCooldown();
  const proven = useRef(false);

  const fail = (e: unknown) => {
    setError(errorText(e));
    setShake((n) => n + 1);
    setBusy(false);
  };

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    proven.current = false;
    try {
      await sendSensitiveCode(supabase, "change_password", locale);
    } catch (err) {
      return fail(err);
    }
    cooldown.start(RESEND_COOLDOWN_S);
    setCode("");
    setStep("code");
    setBusy(false);
  }

  async function save(value: string) {
    setBusy(true);
    setError(null);
    if (!proven.current) {
      try {
        await verifySensitiveCode(supabase, value);
        proven.current = true; // a code works once: a retry after e.g. same_password reuses the proof
      } catch (err) {
        setCode("");
        return fail(err);
      }
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return fail(error);
    setBusy(false);
    setPassword("");
    setStep("done");
  }

  if (step === "idle" || step === "done")
    return (
      <div className="space-y-2">
        <button type="button" className="btn-ghost w-full" onClick={() => setStep("form")} data-testid="change-password">
          <KeyRound size={17} /> {t("profile.changePassword")}
        </button>
        {step === "done" && (
          <p role="status" className="anim-pop-soft rounded-field bg-mint/15 px-4 py-2.5 text-sm font-medium text-mint-ink" data-testid="password-changed">
            {t("profile.passwordChanged")}
          </p>
        )}
      </div>
    );

  return (
    <div className="space-y-3 rounded-field bg-field/60 p-4" data-testid="password-panel">
      <p className="font-display font-extrabold">{t("profile.changePassword")}</p>
      {step === "form" ? (
        <form onSubmit={sendCode} className="space-y-3">
          <div>
            <label className="label" htmlFor="new-password">
              {t("auth.newPassword")}
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              className="input"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-muted">{t("auth.passwordHint")}</p>
          </div>
          <p className="text-sm text-muted">{t("profile.confirmByEmail", { email })}</p>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-3">
            <button type="button" className="btn-calm-ghost flex-1" onClick={() => setStep("idle")} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button key={shake} type="submit" className={cx("btn-primary flex-1", shake > 0 && "anim-shake")} disabled={busy || password.length < 6} data-testid="password-send-code">
              {busy ? t("auth.sendingCode") : t("auth.sendCode")}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t("profile.codeSentTo", { email })}</p>
          <CodeInput value={code} onChange={setCode} onComplete={save} disabled={busy} invalid={!!error} id="password-code" />
          <p className="text-sm">
            <ResendButton left={cooldown.left} busy={busy} onClick={() => void sendCode()} />
          </p>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-3">
            <button type="button" className="btn-calm-ghost flex-1" onClick={() => setStep("form")} disabled={busy}>
              {t("common.back")}
            </button>
            <button key={shake} type="button" className={cx("btn-primary flex-1", shake > 0 && "anim-shake")} disabled={busy || code.length !== 6} onClick={() => save(code)}>
              {busy ? t("common.saving") : t("auth.savePassword")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Change email: a `sensitive_action` code ("change_email") first, which the server requires, then
 * updateUser({ email }). Both addresses get an email.
 */
function ChangeEmail() {
  const { supabase, email } = useBoolaa();
  const t = useTranslations();
  const locale = useLocale();
  const errorText = useErrorText();
  const [step, setStep] = useState<Step>("idle");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const cooldown = useCooldown();

  const fail = (e: unknown) => {
    setError(errorText(e));
    setShake((n) => n + 1);
    setBusy(false);
  };

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendSensitiveCode(supabase, "change_email", locale);
    } catch (err) {
      return fail(err);
    }
    cooldown.start(RESEND_COOLDOWN_S);
    setCode("");
    setStep("code");
    setBusy(false);
  }

  async function confirm(value: string) {
    setBusy(true);
    setError(null);
    try {
      await verifySensitiveCode(supabase, value);
    } catch (err) {
      setCode("");
      return fail(err);
    }
    const { error } = await supabase.auth.updateUser(
      { email: newEmail.trim() },
      { emailRedirectTo: `${window.location.origin}/auth/callback` },
    );
    if (error) return fail(error);
    setBusy(false);
    setStep("done");
  }

  if (step === "idle" || step === "done")
    return (
      <div className="space-y-2">
        <button type="button" className="btn-ghost w-full" onClick={() => setStep("form")} data-testid="change-email">
          <Mail size={17} /> {t("profile.changeEmail")}
        </button>
        {step === "done" && (
          <p role="status" className="anim-pop-soft rounded-field bg-mint/15 px-4 py-2.5 text-sm font-medium text-mint-ink" data-testid="email-change-sent">
            {t("profile.emailChangeSent", { email: newEmail.trim() })}
          </p>
        )}
      </div>
    );

  return (
    <div className="space-y-3 rounded-field bg-field/60 p-4" data-testid="email-panel">
      <p className="font-display font-extrabold">{t("profile.changeEmail")}</p>
      {step === "form" ? (
        <form onSubmit={sendCode} className="space-y-3">
          <div>
            <label className="label" htmlFor="new-email">
              {t("profile.newEmail")}
            </label>
            <input
              id="new-email"
              type="email"
              autoComplete="email"
              className="input"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
            />
          </div>
          <p className="text-sm text-muted">{t("profile.changeEmailNote")}</p>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-3">
            <button type="button" className="btn-calm-ghost flex-1" onClick={() => setStep("idle")} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button
              key={shake}
              type="submit"
              className={cx("btn-primary flex-1", shake > 0 && "anim-shake")}
              disabled={busy || !newEmail.includes("@") || newEmail.trim().toLowerCase() === email.toLowerCase()}
              data-testid="email-send-code"
            >
              {busy ? t("auth.sendingCode") : t("auth.sendCode")}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t("profile.codeSentTo", { email })}</p>
          <CodeInput value={code} onChange={setCode} onComplete={confirm} disabled={busy} invalid={!!error} id="email-code" />
          <p className="text-sm">
            <ResendButton left={cooldown.left} busy={busy} onClick={() => void sendCode()} />
          </p>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-3">
            <button type="button" className="btn-calm-ghost flex-1" onClick={() => setStep("form")} disabled={busy}>
              {t("common.back")}
            </button>
            <button key={shake} type="button" className={cx("btn-primary flex-1", shake > 0 && "anim-shake")} disabled={busy || code.length !== 6} onClick={() => confirm(code)}>
              {busy ? t("common.saving") : t("profile.changeEmail")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Device = { device_hash: string; label: string | null; created_at: string; last_seen_at: string };

/** "Your devices": list_my_devices(), "This device" by hash, revoke (with a confirmation) on the others. */
function Devices() {
  const { supabase } = useBoolaa();
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const fmt = useFormat();
  const [rows, setRows] = useState<Device[] | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data, error }, hash] = await Promise.all([supabase.rpc("list_my_devices"), sha256Hex(getDeviceId())]);
    setMine(hash);
    if (error) setError(errorText(error));
    setRows((data ?? []) as Device[]);
  }, [supabase, errorText]);

  useEffect(() => {
    // Loads once on open; setState happens after the awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function revoke(hash: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("revoke_device", { p_device_hash: hash });
    setBusy(false);
    setConfirming(null);
    if (error) return setError(errorText(error));
    await load();
  }

  const sorted = [...(rows ?? [])].sort((a, b) => Number(b.device_hash === mine) - Number(a.device_hash === mine));
  return (
    <section className="mt-6 border-t border-line pt-5" aria-labelledby="devices-title" data-testid="devices">
      <h3 id="devices-title" className="mb-1 font-semibold">
        {t("devicesTitle")}
      </h3>
      <p className="mb-3 text-sm text-muted">{t("devicesHint")}</p>
      {rows !== null && rows.length === 0 && !error && <p className="text-sm text-muted">{t("noDevices")}</p>}
      <ul className="space-y-2">
        {sorted.map((d) => {
          const current = d.device_hash === mine;
          const name = d.label || t("unknownDevice");
          const Icon = /iOS|iPadOS|Android|iPhone|Pixel/.test(name) ? Smartphone : Laptop;
          return (
            <li key={d.device_hash} className="rounded-field bg-field/60 p-3" data-testid="device-row" data-current={current || undefined}>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-ink">
                  <Icon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{name}</span>
                    {current && (
                      <span className="rounded-full bg-mint/20 px-2 py-0.5 font-display text-xs font-extrabold text-mint-ink" data-testid="this-device">
                        {t("thisDevice")}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted">{t("lastActive", { time: fmt.relative(d.last_seen_at) })}</p>
                </div>
                {!current && confirming !== d.device_hash && (
                  <button
                    type="button"
                    className="chip bg-danger/10 text-danger-ink hover:bg-danger/15"
                    onClick={() => setConfirming(d.device_hash)}
                    data-testid="revoke-device"
                  >
                    <X size={15} /> {t("revoke")}
                  </button>
                )}
              </div>
              {confirming === d.device_hash && (
                <div className="mt-3 space-y-2 border-t border-line pt-3" data-testid="revoke-panel">
                  <p className="text-sm font-semibold">{t("revokeTitle", { device: name })}</p>
                  <p className="text-sm text-muted">{t("revokeBody")}</p>
                  <div className="flex gap-2">
                    <button type="button" className="btn-calm-ghost flex-1" onClick={() => setConfirming(null)} disabled={busy}>
                      {tc("cancel")}
                    </button>
                    <button type="button" className="btn-destructive flex-1" onClick={() => revoke(d.device_hash)} disabled={busy} data-testid="revoke-confirm">
                      {t("revokeConfirm")}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

/** Profile sheet: sign-in & security (password, email) and "Your devices". */
export function AccountSecurity() {
  const t = useTranslations("profile");
  return (
    <>
      <section className="mt-6 space-y-3 border-t border-line pt-5" aria-labelledby="security-title" data-testid="security">
        <h3 id="security-title" className="font-semibold">
          {t("securityTitle")}
        </h3>
        <ChangePassword />
        <ChangeEmail />
      </section>
      <Devices />
    </>
  );
}
