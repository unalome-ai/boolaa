#!/usr/bin/env node
// Keeps messages/*.json in sync with messages/en.json (the source of truth) and valid.
// Fails (exit 1) when a locale:
//   - is missing a key or has an extra key, or a value is not a non-empty string
//   - has a message that is not valid ICU MessageFormat (incl. rich-text tags)
//   - uses different arguments/tags than en (e.g. {count} renamed or dropped)
//   - lacks a plural category the language needs for whole numbers (ro: one/few/other, …)
//   - contains Romanian cedilla letters ş/ţ instead of comma-below ș/ț
//   - leaves a value identical to English, unless allow-listed below (words that are the same)
// and that content/legal/<locale>.json (privacy + terms) exists and matches English's structure.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const dir = process.env.I18N_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "messages");
const LOCALES = ["en", "ro", "fr", "es", "it"];

// Values that are legitimately identical to English in a given language.
const SAME_AS_EN = {
  ro: ["settings.admin", "reactions.laugh", "landing.copyright", "safety.reasons.spam", "nav.chat", "home.chat", "home.link", "auth.email", "links.url", "search.kindLink"],
  fr: ["settings.admin", "reactions.laugh", "landing.copyright", "notifications.title", "landing.navFaq", "safety.reasons.spam", "common.description", "common.photo", "chat.photo", "chat.messageLabel", "nav.sidebar", "links.url", "search.kindMessage"],
  es: ["settings.admin", "landing.copyright", "safety.reasons.spam", "nav.chat", "home.chat", "links.url"],
  it: ["settings.admin", "reactions.wow", "landing.copyright", "landing.navFaq", "landing.navPrivacy", "safety.reasons.spam", "nav.home", "nav.chat", "home.chat", "nav.links", "home.link", "settings.sharedLinks", "auth.email", "auth.password", "links.url", "search.kindLink"],
};

const errors = [];
const fail = (msg) => errors.push(msg);

function flatten(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

/** Collects argument names, tag names and plural nodes of a parsed message. */
function inspect(ast, acc = { args: new Set(), plurals: [] }) {
  for (const el of ast) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time)
      acc.args.add(el.value);
    else if (el.type === TYPE.tag) {
      acc.args.add(`<${el.value}>`);
      inspect(el.children, acc);
    } else if (el.type === TYPE.plural || el.type === TYPE.select) {
      acc.args.add(el.value);
      if (el.type === TYPE.plural && el.pluralType !== "ordinal") acc.plurals.push(el);
      for (const opt of Object.values(el.options)) inspect(opt.value, acc);
    }
  }
  return acc;
}

/** Plural categories a language actually uses for whole numbers 0…10000. */
function neededCategories(locale) {
  const pr = new Intl.PluralRules(locale);
  const cats = new Set();
  for (let n = 0; n <= 10000; n++) cats.add(pr.select(n));
  return cats;
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
for (const f of files) if (!LOCALES.includes(f.replace(/\.json$/, ""))) fail(`unexpected file messages/${f}`);

const load = (l) => {
  try {
    return flatten(JSON.parse(readFileSync(path.join(dir, `${l}.json`), "utf8")));
  } catch (e) {
    fail(`messages/${l}.json: cannot read/parse (${e.message})`);
    return new Map();
  }
};

const en = load("en");
const enInfo = new Map();
for (const [key, value] of en) {
  try {
    enInfo.set(key, inspect(parse(String(value))));
  } catch (e) {
    fail(`en: ${key}: invalid ICU (${e.message})`);
  }
}

for (const locale of LOCALES) {
  const msgs = locale === "en" ? en : load(locale);
  const need = neededCategories(locale);
  for (const key of en.keys()) if (!msgs.has(key)) fail(`${locale}: missing key ${key}`);
  for (const [key, value] of msgs) {
    if (!en.has(key)) {
      fail(`${locale}: extra key ${key}`);
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      fail(`${locale}: ${key}: must be a non-empty string`);
      continue;
    }
    let info;
    try {
      info = inspect(parse(value));
    } catch (e) {
      fail(`${locale}: ${key}: invalid ICU (${e.message})`);
      continue;
    }
    const ref = enInfo.get(key);
    if (ref) {
      const a = [...info.args].sort().join(",");
      const b = [...ref.args].sort().join(",");
      if (a !== b) fail(`${locale}: ${key}: arguments {${a}} differ from en {${b}}`);
    }
    for (const node of info.plurals) {
      const have = new Set(Object.keys(node.options));
      for (const cat of need) if (!have.has(cat)) fail(`${locale}: ${key}: plural "${node.value}" lacks category "${cat}"`);
    }
    if (locale === "ro" && /[şţŞŢ]/.test(value)) fail(`ro: ${key}: uses cedilla ş/ţ; use comma-below ș/ț`);
    if (locale !== "en" && value === en.get(key) && !(SAME_AS_EN[locale] ?? []).includes(key))
      fail(`${locale}: ${key}: identical to English ("${value}"); translate it or allow-list it in scripts/i18n-check.mjs`);
  }
}

// Long-form legal pages: content/legal/<locale>.json must exist for every locale, with the same
// documents and sections (same ids, same order) as English, no empty text, the same "[...]"
// placeholders, and correct Romanian diacritics.
const legalDir = path.join(dir, "..", "content", "legal");
const loadLegal = (l) => {
  try {
    return JSON.parse(readFileSync(path.join(legalDir, `${l}.json`), "utf8"));
  } catch (e) {
    fail(`content/legal/${l}.json: missing or invalid (${e.message})`);
    return null;
  }
};
const placeholders = (doc) => [...new Set(JSON.stringify(doc).match(/\[[^\]"]+\]/g) ?? [])].sort().join(" ");
// URLs and email addresses must be the same in every language (they become links).
const links = (doc) =>
  [...new Set(JSON.stringify(doc).match(/https?:\/\/[^\s)"]+[^\s)".,;:]|[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/g) ?? [])].sort().join(" ");
const legalEn = loadLegal("en");
for (const locale of LOCALES) {
  const legal = locale === "en" ? legalEn : loadLegal(locale);
  if (!legal || !legalEn) continue;
  for (const kind of ["privacy", "terms"]) {
    const doc = legal[kind];
    const ref = legalEn[kind];
    if (!doc) {
      fail(`legal ${locale}: missing document "${kind}"`);
      continue;
    }
    if (!doc.title?.trim() || !doc.intro?.trim()) fail(`legal ${locale}/${kind}: empty title or intro`);
    const ids = (doc.sections ?? []).map((x) => x.id).join(",");
    const refIds = ref.sections.map((x) => x.id).join(",");
    if (ids !== refIds) fail(`legal ${locale}/${kind}: sections [${ids}] differ from en [${refIds}]`);
    for (const sec of doc.sections ?? []) {
      if (!sec.title?.trim() || !Array.isArray(sec.body) || sec.body.length === 0 || sec.body.some((b) => typeof b !== "string" || !b.trim()))
        fail(`legal ${locale}/${kind}#${sec.id}: empty title or body`);
    }
    if (placeholders(doc) !== placeholders(ref)) fail(`legal ${locale}/${kind}: placeholders differ from en`);
    if (links(doc) !== links(ref)) fail(`legal ${locale}/${kind}: URLs or email addresses differ from en`);
    if (locale === "ro" && /[şţŞŢ]/.test(JSON.stringify(doc))) fail(`legal ro/${kind}: uses cedilla ş/ţ`);
  }
}

if (errors.length) {
  console.error(`i18n check failed (${errors.length}):\n  ` + errors.join("\n  "));
  process.exit(1);
}
console.log(`i18n check passed: ${LOCALES.length} locales × ${en.size} keys in sync, ICU valid; legal pages complete.`);
