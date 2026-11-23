// Branded "Soft pop" email renderer shared by send-email, device-code and report-alert.
// Table-based, inline-styled HTML (Gmail, Outlook, Apple Mail), dark-mode aware,
// no external images: the logo is CSS circles. Strings: ./locales/<locale>.json.
import en from "./locales/en.json" with { type: "json" };
import ro from "./locales/ro.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import it from "./locales/it.json" with { type: "json" };

export const LOCALES = ["en", "ro", "fr", "es", "it"] as const;
export type Locale = (typeof LOCALES)[number];
// deno-lint-ignore no-explicit-any
const STRINGS: Record<Locale, any> = { en, ro, fr, es, it };

export const PRIVACY_URL = "https://boolaa.ro/privacy";

export type TemplateKey =
  | "signup" | "recovery" | "magiclink" | "invite"
  | "email_change_current" | "email_change_new"
  | "reauthentication" | "device" | "sensitive_action"
  | "password_changed" | "generic";

export interface RenderInput {
  template: TemplateKey;
  locale?: string | null;
  name?: string | null;
  code?: string | null;
  link?: string | null;
  vars?: Record<string, string>;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function pickLocale(value: unknown): Locale {
  const v = typeof value === "string" ? value.toLowerCase().slice(0, 2) : "";
  return (LOCALES as readonly string[]).includes(v) ? (v as Locale) : "en";
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// Plural strings are { one, few?, many?, other } objects picked with Intl.PluralRules (ro needs
// "few" and "de" from 20 up). code_expiry is plural because {minutes} is not fixed: send-email
// passes AUTH_OTP_EXPIRY_MINUTES (default 10, config.toml otp_expiry = 600 s) and device-code
// passes 10.
function plural(locale: Locale, forms: string | Record<string, string>, n: number): string {
  if (typeof forms === "string") return forms;
  return forms[new Intl.PluralRules(locale).select(n)] ?? forms.other;
}

// Palette (docs/design-system.md 2.1, 2.4).
const C = {
  bg: "#FBF8FF", card: "#FFFFFF", field: "#F1ECFB", ink: "#1E1638", ink2: "#6A6382",
  grape: "#7357F6", grapeDeep: "#5B3FD9", grapeGlow: "#9B86FF", grapeWash: "#EEEAFE",
  coral: "#FF6B5C", sunny: "#FFC93C", mint: "#1EC8A0", danger: "#D92D3A",
  dBg: "#15111F", dCard: "#221C33", dField: "#2C2545", dInk: "#F5F2FF", dInk2: "#ABA4C4", dGrapeText: "#B7A6FF",
};
const DISPLAY = `ui-rounded,'SF Pro Rounded','Nunito','Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif`;
const TEXT = `system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

const orb = (size: number, from: string, to: string, extra = "") =>
  `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${to};` +
  `background-image:radial-gradient(circle at 35% 30%,${from} 0%,${to} 75%);${extra}"></span>`;

function logo(): string {
  // Grape orb with coral, sunny and mint friends (design-system 4.5), CSS only.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
<td style="padding:0 6px 0 0;vertical-align:middle;line-height:0;">
${orb(36, C.grapeGlow, C.grapeDeep, "box-shadow:inset -3px -4px 0 rgba(0,0,0,0.08);")}
</td>
<td style="vertical-align:top;line-height:0;padding-top:2px;">${orb(13, "#FF9A82", C.coral)}<br>${orb(8, "#FFE07A", C.sunny, "margin:4px 0 0 6px;")}</td>
<td style="padding-left:10px;vertical-align:middle;font-family:${DISPLAY};font-size:26px;font-weight:800;color:${C.grape};letter-spacing:-0.5px;" class="bl-brand">Boolaa</td>
</tr></table>`;
}

function button(href: string, label: string): string {
  const h = escapeHtml(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0;"><tr>
<td align="center" bgcolor="${C.grape}" style="border-radius:27px;background:${C.grape};background-image:linear-gradient(180deg,${C.grape},${C.grapeDeep});">
<a href="${h}" target="_blank" style="display:inline-block;padding:15px 32px;font-family:${DISPLAY};font-size:17px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:27px;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

function codeBlock(code: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 8px;"><tr>
<td align="center" class="bl-code" style="background:${C.grapeWash};border:1.5px dashed #B5A6F5;border-radius:24px;padding:18px 12px;">
<div class="bl-muted" style="font-family:${DISPLAY};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${C.ink2};margin-bottom:6px;">${escapeHtml(label)}</div>
<div class="bl-codetext" style="font-family:${DISPLAY};font-size:38px;line-height:44px;font-weight:800;letter-spacing:10px;color:${C.grapeDeep};mso-line-height-rule:exactly;">${escapeHtml(code)}</div>
</td></tr></table>`;
}

export interface LayoutInput {
  lang: string;
  preheader: string;
  title: string;
  bodyHtml: string;
  footerHtml: string;
}

export function layout({ lang, preheader, title, bodyHtml, footerHtml }: LayoutInput): string {
  return `<!DOCTYPE html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin:0; padding:0; }
  a { color:${C.grapeDeep}; }
  @media (prefers-color-scheme: dark) {
    .bl-bg { background:${C.dBg} !important; }
    .bl-card { background:${C.dCard} !important; border-color:rgba(255,255,255,0.08) !important; }
    .bl-ink { color:${C.dInk} !important; }
    .bl-muted { color:${C.dInk2} !important; }
    .bl-brand, .bl-codetext, .bl-link { color:${C.dGrapeText} !important; }
    .bl-code { background:${C.dField} !important; border-color:#5B4E8A !important; }
  }
  [data-ogsc] .bl-bg { background:${C.dBg} !important; }
  [data-ogsc] .bl-card { background:${C.dCard} !important; }
  [data-ogsc] .bl-ink { color:${C.dInk} !important; }
  [data-ogsc] .bl-muted { color:${C.dInk2} !important; }
  [data-ogsc] .bl-codetext, [data-ogsc] .bl-brand { color:${C.dGrapeText} !important; }
  @media (max-width:620px) { .bl-pad { padding:24px 20px !important; } }
</style>
</head>
<body class="bl-bg" style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bl-bg" style="background:${C.bg};">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td align="center" style="padding:0 0 20px;">${logo()}</td></tr>
    <tr><td class="bl-card bl-pad" style="background:${C.card};border:1px solid #ECE8F4;border-radius:32px;padding:36px 36px 32px;box-shadow:0 8px 16px rgba(42,27,94,0.08);">
      <h1 class="bl-ink" style="margin:0 0 16px;font-family:${DISPLAY};font-size:26px;line-height:32px;font-weight:800;color:${C.ink};">${escapeHtml(title)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td align="center" class="bl-muted" style="padding:20px 24px 0;font-family:${TEXT};font-size:12px;line-height:18px;color:${C.ink2};">${footerHtml}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

const p = (html: string, extra = "") =>
  `<p class="bl-ink" style="margin:0 0 14px;font-family:${TEXT};font-size:16px;line-height:24px;color:${C.ink};${extra}">${html}</p>`;
const small = (html: string) =>
  `<p class="bl-muted" style="margin:14px 0 0;font-family:${TEXT};font-size:13px;line-height:20px;color:${C.ink2};">${html}</p>`;

export function render(input: RenderInput): RenderedEmail {
  const locale = pickLocale(input.locale);
  const S = STRINGS[locale];
  const T = S[input.template] ?? S.generic;
  const vars: Record<string, string> = { minutes: "10", ...input.vars };
  const tx = (s: string) => fill(s, vars);
  const htx = (s: string) => fill(escapeHtml(s), Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, `<strong>${escapeHtml(v)}</strong>`])));

  const name = (input.name ?? "").trim();
  const greeting = name ? fill(S.greeting, { name }) : S.greeting_noname;
  const html: string[] = [p(escapeHtml(greeting)), p(htx(T.intro))];
  const text: string[] = [greeting, "", tx(T.intro)];

  if (input.code) {
    const expiry = tx(plural(locale, S.code_expiry, Number(vars.minutes) || 10));
    html.push(codeBlock(input.code, S.code_label));
    html.push(small(escapeHtml(expiry)));
    text.push("", `${S.code_label}: ${input.code}`, expiry);
  }
  if (input.link && T.button) {
    if (input.code) {
      html.push(small(escapeHtml(S.link_alternative)));
      html.push(`<p style="margin:6px 0 0;font-family:${TEXT};font-size:13px;line-height:20px;"><a class="bl-link" href="${escapeHtml(input.link)}" style="color:${C.grapeDeep};font-weight:600;">${escapeHtml(T.button)}</a></p>`);
    } else {
      html.push(button(input.link, T.button));
    }
    text.push("", `${input.code ? S.link_alternative : T.button + ":"} ${input.link}`);
  }
  if (T.warning) {
    html.push(small(escapeHtml(T.warning)));
    text.push("", T.warning);
  }
  if (input.code) {
    html.push(small(escapeHtml(S.ignore)));
    text.push("", S.ignore);
  }

  const footerHtml = `${escapeHtml(S.footer)}<br><a class="bl-link" href="${PRIVACY_URL}" style="color:${C.grapeDeep};">${escapeHtml(S.privacy)}</a> · Boolaa`;
  text.push("", "--", S.footer, `${S.privacy}: ${PRIVACY_URL}`);

  return {
    subject: tx(T.subject),
    html: layout({ lang: locale, preheader: tx(T.preheader), title: tx(T.title), bodyHtml: html.join("\n"), footerHtml }),
    text: text.join("\n"),
  };
}

export function sensitiveActionLabel(locale: string, action: string | undefined): string {
  const S = STRINGS[pickLocale(locale)];
  return S.sensitive_action.actions[action ?? "generic"] ?? S.sensitive_action.actions.generic;
}

export function unknownDeviceLabel(locale: string): string {
  return STRINGS[pickLocale(locale)].device.unknown_device;
}
