"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Ban, Flag, MoreHorizontal, ShieldCheck, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useBoolaa } from "@/components/boolaa-provider";
import { ErrorText, Modal } from "@/components/ui";
import { useErrorText } from "@/i18n/errors";
import { cx } from "@/lib/utils";
import { useMenuKeys } from "@/lib/a11y";

export type ReportTarget = "user" | "chat_message" | "event" | "food_post" | "market_item" | "shared_link";
export const REPORT_REASONS = ["spam", "harassment", "hate", "sexual", "violence", "self_harm", "other"] as const;

type Author = { id: string; name: string | null | undefined } | null | undefined;

/**
 * "…" menu with Report and Block/Unblock for someone else's content (or a member, type "user").
 * Renders nothing on your own content: the server refuses to let you report yourself.
 */
export function SafetyMenu({
  type,
  id,
  author,
  className,
  compact,
}: {
  type: ReportTarget;
  id: string;
  author: Author;
  className?: string;
  /** Smaller trigger, e.g. under a chat bubble. */
  compact?: boolean;
}) {
  const { userId, blocked, unblock } = useBoolaa();
  const t = useTranslations("safety");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useMenuKeys(open, () => setOpen(false), menuRef, trigger);

  if (!author || author.id === userId) return null;
  const name = author.name ?? tc("someone");
  const isBlocked = blocked.has(author.id);

  return (
    <div ref={ref} className={cx("relative", className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={t("moreActions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex items-center justify-center rounded-full text-muted hover:bg-field hover:text-fg",
          compact ? "h-6 w-6" : "h-8 w-8",
        )}
        data-testid="safety-menu"
      >
        <MoreHorizontal size={compact ? 15 : 18} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("moreActions")}
          className={cx(
            "absolute top-full z-[250] mt-1 min-w-48 overflow-hidden rounded-field border border-line bg-card py-1 shadow-float",
            compact ? "left-0" : "right-0",
          )}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setReporting(true);
            }}
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-field"
            data-testid="report"
          >
            <Flag size={16} /> {t("report")}
          </button>
          {isBlocked ? (
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                trigger.current?.focus();
                setOpen(false);
                await unblock(author.id).catch((e) => setError(errorText(e)));
              }}
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-field"
              data-testid="unblock"
            >
              <Undo2 size={16} /> {t("unblockNamed", { name })}
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                trigger.current?.focus();
                setOpen(false);
                setBlocking(true);
              }}
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger-ink hover:bg-field"
              data-testid="block"
            >
              <Ban size={16} /> {t("blockNamed", { name })}
            </button>
          )}
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <ReportDialog open={reporting} onClose={() => setReporting(false)} type={type} id={id} author={{ id: author.id, name }} />
      <BlockDialog open={blocking} onClose={() => setBlocking(false)} author={{ id: author.id, name }} />
    </div>
  );
}

function ReportDialog({
  open,
  onClose,
  type,
  id,
  author,
}: {
  open: boolean;
  onClose: () => void;
  type: ReportTarget;
  id: string;
  author: { id: string; name: string };
}) {
  const t = useTranslations("safety");
  return (
    <Modal open={open} onClose={onClose} title={type === "user" ? t("reportMemberTitle") : t("reportTitle")}>
      {open && <ReportForm onClose={onClose} type={type} id={id} author={author} />}
    </Modal>
  );
}

function ReportForm({
  onClose,
  type,
  id,
  author,
}: {
  onClose: () => void;
  type: ReportTarget;
  id: string;
  author: { id: string; name: string };
}) {
  const { supabase, blocked, block } = useBoolaa();
  const t = useTranslations("safety");
  const errorText = useErrorText();
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number] | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("report_content", {
      p_target_type: type,
      p_target_id: id,
      p_reason: reason,
      p_details: details.trim() || undefined,
    });
    setBusy(false);
    if (error) return setError(errorText(error));
    setSent(true);
  }

  async function alsoBlock() {
    setBusy(true);
    try {
      await block(author.id);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4" data-testid="report-sent">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mint/15 text-mint-ink">
            <ShieldCheck size={20} />
          </span>
          <div>
            <p className="font-semibold">{t("thanksTitle")}</p>
            <p className="text-sm text-muted">{t("thanksBody")}</p>
          </div>
        </div>
        {!blocked.has(author.id) && (
          <div className="rounded-field bg-field p-4">
            <p className="font-semibold">{t("alsoBlock", { name: author.name })}</p>
            <p className="mb-3 text-sm text-muted">{t("blockHint")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={alsoBlock} disabled={busy} className="btn-destructive" data-testid="also-block">
                <Ban size={16} /> {t("block")}
              </button>
              <button type="button" onClick={onClose} className="btn-calm-ghost">
                {t("notNow")}
              </button>
            </div>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        {blocked.has(author.id) && (
          <button type="button" onClick={onClose} className="btn-calm w-full">
            {t("done")}
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-muted">{t("why")}</legend>
        <div className="space-y-1.5">
          {REPORT_REASONS.map((r) => (
            <label
              key={r}
              className={cx(
                "flex cursor-pointer items-center gap-3 rounded-field border-2 px-3 py-2.5 text-[15px] transition-colors duration-200",
                reason === r ? "border-grape bg-brand/10" : "border-line hover:bg-field",
              )}
            >
              <input
                type="radio"
                name="reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="accent-[var(--color-brand)]"
                data-testid={`reason-${r}`}
              />
              {t(`reasons.${r}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="report-details">
          {t("details")}
        </label>
        <textarea
          id="report-details"
          className="input min-h-20"
          maxLength={1000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={t("detailsPlaceholder")}
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-calm w-full" disabled={busy || !reason} data-testid="report-submit">
        <Flag size={16} /> {busy ? t("sending") : t("send")}
      </button>
    </form>
  );
}

/** Confirmation before blocking (explains what it does). */
export function BlockDialog({ open, onClose, author }: { open: boolean; onClose: () => void; author: { id: string; name: string } }) {
  const { block } = useBoolaa();
  const t = useTranslations("safety");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title={t("blockTitle", { name: author.name })}>
      <p className="mb-5 text-muted">{t("blockHint")}</p>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="btn-calm-ghost flex-1">
          {tc("cancel")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await block(author.id);
              onClose();
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
          className="btn-destructive flex-1"
          data-testid="block-confirm"
        >
          <Ban size={16} /> {t("block")}
        </button>
      </div>
    </Modal>
  );
}
