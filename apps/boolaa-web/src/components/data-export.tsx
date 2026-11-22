"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { CodeInput, ResendButton, useCooldown } from "@/components/code-input";
import { ErrorText } from "@/components/ui";
import { errorKey, useErrorText } from "@/i18n/errors";
import { fetchMyData, saveBlob } from "@/lib/data-export";
import { RESEND_COOLDOWN_S, markSent, sendSensitiveCode, verifySensitiveCode } from "@/lib/device";
import type { BoolaaClient } from "@/lib/supabase/client";

/**
 * "Download my data" (GDPR right of access; docs/boolaa-spec.md "Data export"): explanation, then
 * an emailed `sensitive_action` code ("export_data"), then the `data-export` function's JSON file is
 * downloaded. Once per hour (the server says when not).
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

  async function sendCode() {
    setBusy("sending");
    setError(null);
    try {
      await sendSensitiveCode(supabase, "export_data", locale);
      markSent("sensitive_action");
      cooldown.start(RESEND_COOLDOWN_S);
      setCode("");
      setStep("code");
    } catch (e) {
      setError(errorText(e));
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
      setError(errorText(e));
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
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-3">
        <button type="button" className="btn-ghost flex-1" onClick={onClose} disabled={!!busy}>
          {step === "done" ? t("common.close") : t("common.cancel")}
        </button>
        {step === "intro" && (
          <button type="button" className="btn-primary flex-1" disabled={!!busy} onClick={sendCode} data-testid="export-send">
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
