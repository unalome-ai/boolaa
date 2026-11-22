"use client";

import { useState, type FormEvent } from "react";
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
          className="w-full accent-[#9D78BD]"
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-primary w-full" disabled={busy || !name.trim()}>
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
          className="input font-mono uppercase tracking-[0.2em]"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="FLAT2026"
          autoCapitalize="characters"
        />
      </div>
      <p className="text-sm text-muted">{t("joinHint")}</p>
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn-primary w-full" disabled={busy || !code.trim()}>
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
  return (
    <div>
      <div className="mb-5 grid grid-cols-2 rounded-full bg-chip p-1" role="tablist">
        {(["create", "join"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            data-testid={`tab-${k}`}
            onClick={() => setTab(k)}
            className={cx(
              "rounded-full py-2 text-sm font-semibold transition",
              tab === k ? "bg-brand text-white shadow-soft" : "text-brand",
            )}
          >
            {k === "create" ? t("tabCreate") : t("tabJoin")}
          </button>
        ))}
      </div>
      {tab === "create" ? <CreateBubbleForm onCreated={onCreated} /> : <JoinBubbleForm onRequested={onRequested} />}
    </div>
  );
}
