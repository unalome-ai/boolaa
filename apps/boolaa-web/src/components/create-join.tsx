"use client";

import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Bubble } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/i18n/errors";
import { cx } from "@/lib/utils";
import { ErrorText } from "@/components/ui";

export function CreateBubbleForm({ onCreated }: { onCreated: (b: Bubble) => void }) {
  const t = useTranslations();
  const errorText = useErrorText();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxSize, setMaxSize] = useState(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await getSupabase().rpc("create_bubble", {
      p_name: name.trim(),
      p_description: description.trim(),
      p_max_size: maxSize,
    });
    setBusy(false);
    if (error || !data) return setError(errorText(error));
    onCreated(data);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="bubble-name">
          {t("createJoin.bubbleName")}
        </label>
        <input
          id="bubble-name"
          className="input"
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("createJoin.bubbleNamePlaceholder")}
        />
      </div>
      <div>
        <label className="label" htmlFor="bubble-desc">
          {t("common.description")}
        </label>
        <textarea
          id="bubble-desc"
          className="input min-h-20"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("createJoin.descriptionPlaceholder")}
        />
      </div>
      <div>
        <label className="label" htmlFor="bubble-size">
          {t("createJoin.maxSize", { count: maxSize })}
        </label>
        <input
          id="bubble-size"
          type="range"
          min={2}
          max={150}
          value={maxSize}
          onChange={(e) => setMaxSize(Number(e.target.value))}
          className="w-full accent-[var(--grape)]"
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-primary min-h-[54px] w-full text-[17px]" disabled={busy || !name.trim()}>
        {busy ? t("createJoin.creating") : t("createJoin.create")}
      </button>
    </form>
  );
}

export function JoinBubbleForm({ onRequested }: { onRequested: () => void }) {
  const t = useTranslations("createJoin");
  const errorText = useErrorText();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().rpc("request_to_join", { p_invite_code: code.trim() });
    setBusy(false);
    if (error) return setError(errorText(error));
    setCode("");
    onRequested();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="invite-code">
          {t("inviteCode")}
        </label>
        <input
          id="invite-code"
          className="input font-display font-extrabold uppercase tracking-[0.2em]"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="FLAT2026"
          autoCapitalize="characters"
        />
      </div>
      <p className="text-sm text-muted">{t("joinHint")}</p>
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-primary min-h-[54px] w-full text-[17px]" disabled={busy || !code.trim()}>
        {busy ? t("sending") : t("requestJoin")}
      </button>
    </form>
  );
}

export function CreateJoinTabs({
  onCreated,
  onRequested,
  initial = "create",
}: {
  onCreated: (b: Bubble) => void;
  onRequested: () => void;
  initial?: "create" | "join";
}) {
  const [tab, setTab] = useState<"create" | "join">(initial);
  const t = useTranslations("createJoin");
  const id = useId();
  // Tabs pattern: arrow keys switch and focus the other tab; only the selected tab is in the Tab order.
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? "create" : e.key === "End" ? "join" : tab === "create" ? "join" : "create";
    setTab(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };
  return (
    <div>
      <div className="relative mb-5 grid grid-cols-2 rounded-full bg-field p-1" role="tablist">
        <span
          aria-hidden
          className="slide fill-hue absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full"
          style={{
            transform: tab === "join" ? "translateX(100%)" : "none",
            transition: "transform var(--dur-snappy) var(--ease-snappy)",
          }}
        />
        {(["create", "join"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`${id}-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`${id}-panel`}
            tabIndex={tab === k ? 0 : -1}
            onKeyDown={onKey}
            data-testid={`tab-${k}`}
            onClick={() => setTab(k)}
            className={cx(
              "relative min-h-10 rounded-full px-2 text-[15px] font-bold transition-colors duration-200",
              tab === k ? "text-white" : "text-muted hover:text-fg",
            )}
          >
            {k === "create" ? t("tabCreate") : t("tabJoin")}
          </button>
        ))}
      </div>
      <div key={tab} className="anim-fade" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
      {tab === "create" ? <CreateBubbleForm onCreated={onCreated} /> : <JoinBubbleForm onRequested={onRequested} />}
      </div>
    </div>
  );
}
