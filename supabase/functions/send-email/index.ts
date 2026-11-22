// Supabase Auth "Send Email" hook: renders Boolaa's localized emails and sends
// them through Resend (or local Mailpit). Configured in config.toml
// [auth.hook.send_email] locally and in the dashboard (Auth > Hooks) in production.
// Env: SEND_EMAIL_HOOK_SECRET ("v1,whsec_..."), AUTH_PUBLIC_URL, AUTH_OTP_EXPIRY_MINUTES,
//      RESEND_API_KEY (unset locally -> Mailpit SMTP).
import { Webhook } from "npm:standardwebhooks@1.0.0";
import { render, type TemplateKey } from "../_shared/email/render.ts";
import { sendMail } from "../_shared/mailer.ts";

interface HookUser {
  id: string;
  email: string;
  new_email?: string;
  user_metadata?: Record<string, unknown>;
}
interface EmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
  old_email?: string;
}

const hookError = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function verifyLink(tokenHash: string, type: string, redirectTo: string): string {
  const base = (Deno.env.get("AUTH_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const q = new URLSearchParams({ token: tokenHash, type });
  if (redirectTo) q.set("redirect_to", redirectTo);
  return `${base}/auth/v1/verify?${q}`;
}

const TEMPLATE_FOR: Record<string, TemplateKey> = {
  signup: "signup",
  recovery: "recovery",
  magiclink: "magiclink",
  email: "magiclink",
  invite: "invite",
  reauthentication: "reauthentication",
  password_changed_notification: "password_changed",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return hookError(405, "method not allowed");

  const secret = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace(/^v1,whsec_/, "");
  if (!secret) return hookError(500, "hook secret not configured");

  const payload = await req.text();
  let user: HookUser, data: EmailData;
  try {
    ({ user, email_data: data } = new Webhook(secret).verify(payload, Object.fromEntries(req.headers)) as {
      user: HookUser;
      email_data: EmailData;
    });
  } catch {
    return hookError(401, "invalid signature");
  }

  const meta = user.user_metadata ?? {};
  const locale = typeof meta.locale === "string" ? meta.locale : null;
  const name = typeof meta.name === "string" ? meta.name : typeof meta.full_name === "string" ? meta.full_name : null;
  const minutes = Deno.env.get("AUTH_OTP_EXPIRY_MINUTES") ?? "10";
  const action = data.email_action_type;

  try {
    if (action === "email_change") {
      // Secure email change: GoTrue sends one hook call with two token pairs.
      // Verified empirically (GoTrue v2.186): token/token_hash verify with the
      // CURRENT address (verifyOtp email=user.email), token_new/token_hash_new with
      // the NEW one. NOTE: in that version a single verified code completes the
      // change (docs/auth-security.md, "Email change").
      const oldEmail = user.email;
      const newEmail = user.new_email ?? "";
      const vars = { old_email: oldEmail, new_email: newEmail, minutes };
      const jobs: Promise<unknown>[] = [];
      if (data.token_hash && oldEmail) {
        jobs.push(sendMail({
          to: oldEmail,
          ...render({ template: "email_change_current", locale, name, code: data.token, vars,
            link: verifyLink(data.token_hash, "email_change", data.redirect_to) }),
        }));
      }
      if (data.token_hash_new && newEmail) {
        jobs.push(sendMail({
          to: newEmail,
          ...render({ template: "email_change_new", locale, name, code: data.token_new, vars,
            link: verifyLink(data.token_hash_new, "email_change", data.redirect_to) }),
        }));
      }
      // Single-confirmation mode (secure_email_change off): only the new address gets a token.
      if (!data.token_hash_new && data.token_hash && newEmail && !oldEmail) {
        jobs.push(sendMail({
          to: newEmail,
          ...render({ template: "email_change_new", locale, name, code: data.token, vars,
            link: verifyLink(data.token_hash, "email_change", data.redirect_to) }),
        }));
      }
      await Promise.all(jobs);
    } else {
      const template = TEMPLATE_FOR[action] ?? "generic";
      const linkType = action === "email" ? "magiclink" : action;
      const hasLink = ["signup", "recovery", "magiclink", "email", "invite"].includes(action) && data.token_hash;
      const hasCode = ["signup", "recovery", "magiclink", "email", "reauthentication"].includes(action);
      await sendMail({
        to: user.email,
        ...render({
          template,
          locale,
          name,
          code: hasCode ? data.token : null,
          link: hasLink ? verifyLink(data.token_hash, linkType, data.redirect_to) : null,
          vars: { minutes },
        }),
      });
    }
  } catch (e) {
    console.error("send-email failed", action, (e as Error).message);
    return hookError(500, "email could not be sent");
  }

  return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
});
