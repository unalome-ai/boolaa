// Moderation alert: called by the AFTER INSERT trigger on public.reports (pg_net)
// with {"report_id": "..."} and the header x-report-alert-secret. Emails the
// moderation inbox in English. Never includes email addresses. Setup: docs/moderation.md.
// Env: REPORT_ALERT_SECRET, MODERATION_EMAIL (default moderation@boolaa.ro), RESEND_API_KEY,
// ADMIN_URL (default https://boolaa.ro/admin; the email links to <ADMIN_URL>?report=<id>).
import { createClient } from "npm:@supabase/supabase-js@2";
import { escapeHtml, layout } from "../_shared/email/render.ts";
import { sendMail } from "../_shared/mailer.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const enc = new TextEncoder();
function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ADMIN_URL = (Deno.env.get("ADMIN_URL") || "https://boolaa.ro/admin").replace(/\/+$/, "");

const TARGET_LABEL: Record<string, string> = {
  user: "user profile", chat_message: "chat message", event: "event",
  food_post: "food post", market_item: "marketplace item", shared_link: "shared link",
};

// deno-lint-ignore no-explicit-any
function renderAlert(a: any) {
  const when = new Date(a.created_at).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const target = TARGET_LABEL[a.target_type] ?? a.target_type;
  const subject = `${a.urgent ? "URGENT: " : ""}[Boolaa moderation] ${a.reason} report on a ${target}` +
    (a.bubble_name ? ` in "${a.bubble_name}"` : "");
  const person = (name: string | null, id: string | null) => `${name ?? "(deleted)"} (${id ?? "n/a"})`;
  const rows: [string, string | null][] = [
    ["Reason", a.reason + (a.urgent ? " (URGENT: possible self-harm, act now)" : "")],
    ["Target", `${target} ${a.target_id}`],
    ["Sent", when],
    ["Bubble", a.bubble_name ? `${a.bubble_name} (${a.bubble_id})` : "n/a"],
    ["Reporter", person(a.reporter_name, a.reporter_id)],
    ["Reported user", person(a.reported_user_name, a.reported_user_id)],
    ["Content", a.snippet ?? (a.target_type === "user" ? "(profile report)" : "(content no longer exists)")],
    // Photos are in private buckets (20261123210000_private_photos.sql): a stored URL or path no
    // longer opens from an email, so only say there is one; the admin view signs it.
    ["Image", a.image_url ? "Has a photo: view it in the admin view (link below)" : null],
    ["Link", a.link_url],
    ["Details", a.details ?? "(none)"],
    ["Open reports against this user (30 days)", String(a.open_reports_against_user_30d)],
    ["Reports on this target (10 min)", String(a.reports_on_target_10m)],
    ["Report id", a.report_id],
    ["Open in admin", `${ADMIN_URL}?report=${encodeURIComponent(a.report_id)}`],
  ];
  const shown = rows.filter(([, v]) => v);
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;">` +
    shown.map(([k, v]) => {
      const val = /^https?:\/\//.test(v!) ? `<a href="${escapeHtml(v!)}" style="color:#5B3FD9;">${escapeHtml(v!)}</a>` : escapeHtml(v!);
      return `<tr><td class="bl-muted" style="padding:6px 12px 6px 0;color:#6A6382;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td>` +
        `<td class="bl-ink" style="padding:6px 0;color:#1E1638;word-break:break-word;">${val}</td></tr>`;
    }).join("") +
    `</table><p class="bl-muted" style="margin:16px 0 0;font-family:system-ui,sans-serif;font-size:13px;color:#6A6382;">Apple expects reports to be handled within 24 hours. <a href="${escapeHtml(`${ADMIN_URL}?report=${encodeURIComponent(a.report_id)}`)}" style="color:#5B3FD9;font-weight:600;">Open it in the admin view</a> to act on it.</p>`;
  const text = shown.map(([k, v]) => `${k}: ${v}`).join("\n");
  return {
    subject,
    html: layout({ lang: "en", preheader: subject, title: a.urgent ? "URGENT report" : "New report", bodyHtml: html,
      footerHtml: "Internal moderation alert · Boolaa" }),
    text,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const secret = Deno.env.get("REPORT_ALERT_SECRET") ?? "";
  if (!secret || !timingSafeEqual(req.headers.get("x-report-alert-secret") ?? "", secret)) {
    return json(401, { error: "unauthorized" });
  }
  let reportId: unknown;
  try {
    reportId = (await req.json()).report_id;
  } catch { /* handled below */ }
  if (typeof reportId !== "string") return json(400, { error: "invalid_request" });

  const { data: alert, error } = await admin.rpc("claim_report_alert", { p_report_id: reportId });
  if (error) {
    console.error("report-alert claim failed", error.message);
    return json(500, { error: "server_error" });
  }
  if (!alert?.send) return json(200, { status: "skipped", reason: alert?.reason });

  try {
    await sendMail({ to: Deno.env.get("MODERATION_EMAIL") || "moderation@boolaa.ro", ...renderAlert(alert) });
  } catch (e) {
    console.error("report-alert email failed", (e as Error).message);
    // Release the dedup claim so the next report on this target alerts again.
    await admin.from("reports").update({ alert_sent_at: null }).eq("id", reportId);
    return json(502, { error: "email_failed" });
  }
  return json(200, { status: "sent" });
});
