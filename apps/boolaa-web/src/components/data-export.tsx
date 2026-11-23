"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { CodeInput, ResendButton, useCooldown } from "@/components/code-input";
import { ErrorText } from "@/components/ui";
import { errorKey, useErrorText } from "@/i18n/errors";
import { exportAvailableAt, fetchMyData, rateLimitedUntil, saveBlob } from "@/lib/data-export";
import { useFormat } from "@/i18n/format";
import { RESEND_COOLDOWN_S, markSent, sendSensitiveCode, verifySensitiveCode } from "@/lib/device";
import type { BoolaaClient } from "@/lib/supabase/client";

/**
 * "Download my data" (GDPR right of access; docs/boolaa-spec.md "Data export"): explanation, then
 * an emailed `sensitive_action` code ("export_data"), then the `data-export` function's JSON file is
 * downloaded. Once per hour: the limit is checked when the panel opens and before a code is sent, so a
 * user who already exported sees "try again after HH:MM" instead of getting a code they can't use.
 */
export function DataExportPanel({ supabase, onClose }: { supabase: BoolaaClient; onClose: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const errorText = useErrorText();
  const [step, setStep] = useState<"intro" | "code" | "done">("intro");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<false | "sending" | "preparing">(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown();
  const fmt = useFormat();
  const [limitedUntil, setLimitedUntil] = useState<Date | null>(null);
  const limited = limitedUntil !== null; // cleared by a timer once the hour is over

  /** Shows the "try again after HH:MM" message for a rate-limit error; false for any other error. */
  function showLimit(e: unknown) {
    const until = rateLimitedUntil(e);
    if (!until) return false;
    setLimitedUntil(until);
    setError(null);
    return true;
  }

  // Check the limit up front (the panel just opened).
  useEffect(() => {
    let alive = true;
    exportAvailableAt(supabase)
      .then((at) => alive && setLimitedUntil(at))
      .catch(() => {
        /* the send step checks again */
      });
    return () => {
      alive = false;
    };
  }, [supabase]);

  // Lift the message once the hour is over.
  useEffect(() => {
    if (!limitedUntil) return;
    const id = window.setTimeout(() => setLimitedUntil(null), Math.max(0, limitedUntil.getTime() - Date.now()) + 500);
    return () => window.clearTimeout(id);
  }, [limitedUntil]);

  async function sendCode() {
    setBusy("sending");
    setError(null);
    try {
      const until = await exportAvailableAt(supabase).catch(() => null);
      if (until) {
        setLimitedUntil(until);
        setStep("intro");
        return setBusy(false);
      }
      await sendSensitiveCode(supabase, "export_data", locale);
      markSent("sensitive_action");
      cooldown.start(RESEND_COOLDOWN_S);
      setCode("");
      setStep("code");
    } catch (e) {
      if (showLimit(e)) setStep("intro");
      else setError(errorText(e));
    }
    setBusy(false);
  }

  async function verifyAndDownload(value: string) {
    setBusy("preparing");
    setError(null);
    try {
      await verifySensitiveCode(supabase, value);
    } catch (e) {
      setCode("");
      setError(errorText(e));
      return setBusy(false);
    }
    try {
      const { blob, fileName } = await fetchMyData(supabase);
      saveBlob(blob, fileName);
      setStep("done");
    } catch (e) {
      if (showLimit(e)) setStep("intro");
      else setError(errorText(e));
      // The code proof was used up or is missing: start over with a new code.
      if (errorKey(e) === "reauthenticationRequired") setStep("intro");
      setCode("");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3 rounded-field border border-line bg-field/60 p-4" data-testid="export-panel">
      <p className="font-display font-extrabold">{t("profile.exportTitle")}</p>
      {step === "intro" && (
        <>
          <p className="text-sm text-muted">{t("profile.exportBody")}</p>
          <p className="text-sm text-muted">{t("profile.exportCodeNote")}</p>
        </>
      )}
      {step === "code" && (
        <>
          <p className="text-sm text-muted" data-testid="export-code-sent">
            {t("profile.exportCodeSent")}
          </p>
          <CodeInput value={code} onChange={setCode} onComplete={verifyAndDownload} disabled={!!busy} invalid={!!error} id="export-code" />
          <p className="text-sm">
            <ResendButton left={cooldown.left} busy={!!busy} onClick={sendCode} />
          </p>
        </>
      )}
      {step === "done" && (
        <p className="text-sm font-semibold text-mint-ink" role="status" data-testid="export-done">
          {t("profile.exportDone")}
        </p>
      )}
      {busy === "preparing" && (
        <p className="text-sm text-muted" role="status">
          {t("profile.exportPreparing")}
        </p>
      )}
      {limited && step !== "done" && (
        <p className="text-sm font-semibold text-danger-ink" role="alert" data-testid="export-limited">
          {t("errors.exportRateLimitedUntil", { time: fmt.time(limitedUntil.toISOString()) })}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-3">
        <button type="button" className="btn-ghost flex-1" onClick={onClose} disabled={!!busy}>
          {step === "done" ? t("common.close") : t("common.cancel")}
        </button>
        {step === "intro" && (
          <button type="button" className="btn-primary flex-1" disabled={!!busy || limited} onClick={sendCode} data-testid="export-send">
            {busy === "sending" ? t("auth.sendingCode") : t("profile.exportSendCode")}
          </button>
        )}
        {step === "code" && (
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={code.length !== 6 || !!busy}
            onClick={() => verifyAndDownload(code)}
            data-testid="export-download"
          >
            <Download size={18} /> {t("profile.exportDownload")}
          </button>
        )}
      </div>
    </div>
  );
}
