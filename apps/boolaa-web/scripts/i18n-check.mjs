#!/usr/bin/env node
// Keeps messages/*.json in sync with messages/en.json (the source of truth) and valid.
// Fails (exit 1) when a locale:
//   - is missing a key or has an extra key, or a value is not a non-empty string
//   - has a message that is not valid ICU MessageFormat (incl. rich-text tags)
//   - uses different arguments/tags than en (e.g. {count} renamed or dropped)
//   - lacks a plural category the language needs for whole numbers (ro: one/few/other, …)
//   - contains Romanian cedilla letters ş/ţ instead of comma-below ș/ț
//   - leaves a value identical to English, unless allow-listed below (words that are the same)
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const dir = process.env.I18N_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "messages");
const LOCALES = ["en", "ro", "fr", "es", "it"];

// Values that are legitimately identical to English in a given language.
const SAME_AS_EN = {
  ro: ["nav.chat", "home.chat", "home.link", "auth.email", "links.url"],
  fr: ["common.description", "common.photo", "chat.messageLabel", "nav.sidebar", "links.url"],
  es: ["nav.chat", "home.chat", "links.url"],
  it: ["nav.home", "nav.chat", "home.chat", "nav.links", "home.link", "settings.sharedLinks", "auth.email", "auth.password", "links.url"],
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

if (errors.length) {
  console.error(`i18n check failed (${errors.length}):\n  ` + errors.join("\n  "));
  process.exit(1);
}
console.log(`i18n check passed: ${LOCALES.length} locales × ${en.size} keys in sync, ICU valid.`);
