#!/usr/bin/env python3
"""Fails (exit 1) when Boolaa's string catalogs are incomplete or inconsistent.

    Scripts/check-localizations.py                      # catalog checks only
    Scripts/check-localizations.py --derived-data build/DerivedData
        # + every string the compiler extracted from the code is in the catalog (and none are stale)
        # + the built Boolaa.app has a compiled <lang>.lproj with every key for each language

Checks, per docs/i18n-glossary.md:
  * every key is translated (state "translated") in ro, fr, es, it; no "new"/"needs_review"/"stale"
  * plural variations carry the categories the language needs (ro: one/few/other; others: one/other)
  * format specifiers match the English source (count and types, positional or not)
  * Romanian uses comma-below ș/ț, never cedilla ş/ţ
  * no English left in other locales (identical-to-source only for an explicit allow-list)
"""
import argparse, glob, json, os, plistlib, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = ["ro", "fr", "es", "it"]
ALL_LANGS = ["en"] + LANGS
REQUIRED_PLURALS = {"en": {"one", "other"}, "ro": {"one", "few", "other"},
                    "fr": {"one", "other"}, "es": {"one", "other"}, "it": {"one", "other"}}
# Words that are legitimately the same as English in that language.
ALLOW_IDENTICAL = {
    "OK": set(LANGS), "Chat": {"ro", "es", "it"}, "Email": {"ro", "it"}, "Link": {"ro", "it"},
    "Password": {"it"}, "Home": {"it"}, "Description": {"fr"}, "Message": {"fr"}, "Mode": {"fr"},
    "Links": {"it"},
}
CEDILLAS = re.compile("[ŞşŢţ]")  # Ş ş Ţ ţ
SPEC = re.compile(r"%(?:(\d+)\$)?(#@\w+@|lld|ld|d|@|lf|f|%)")

errors = []
def fail(msg): errors.append(msg)

def specifiers(value):
    """Multiset of argument types; substitution tokens count as integers."""
    out = []
    for _, kind in SPEC.findall(value):
        if kind == "%": continue
        out.append("lld" if kind.startswith("#@") else kind)
    return sorted(out)

def units(loc):
    """Yields (path, stringUnit) for every unit in a localization, including variations and substitutions."""
    if "stringUnit" in loc: yield "", loc["stringUnit"]
    for vname, cases in loc.get("variations", {}).items():
        for case, sub in cases.items():
            for p, u in units(sub): yield f"{vname}.{case}{p}", u
    for sname, sub in loc.get("substitutions", {}).items():
        for vname, cases in sub.get("variations", {}).items():
            for case, s in cases.items():
                for p, u in units(s): yield f"sub:{sname}.{vname}.{case}{p}", u

def plural_sets(loc):
    sets = []
    if "plural" in loc.get("variations", {}): sets.append(("", set(loc["variations"]["plural"])))
    for name, sub in loc.get("substitutions", {}).items():
        if "plural" in sub.get("variations", {}): sets.append((name, set(sub["variations"]["plural"])))
    return sets

def check_catalog(path, check_specifiers=True):
    cat = json.load(open(path, encoding="utf-8"))
    if cat.get("sourceLanguage") != "en": fail(f"{path}: sourceLanguage must be en")
    for key, entry in cat["strings"].items():
        if entry.get("extractionState") == "stale": fail(f"{key!r}: stale (no longer in code)")
        if entry.get("shouldTranslate") is False: continue
        locs = entry.get("localizations", {})
        source_loc = locs.get("en")
        is_plural = any(plural_sets(l) for l in locs.values())
        if is_plural and not source_loc: fail(f"{key!r}: plural key needs an explicit en localization")
        for lang in (ALL_LANGS if is_plural else LANGS):
            loc = locs.get(lang)
            if not loc: fail(f"{key!r}: missing {lang}"); continue
            for p, u in units(loc):
                if u.get("state") != "translated": fail(f"{key!r} [{lang}{p}]: state {u.get('state')!r}")
                v = u.get("value", "")
                if not v.strip(): fail(f"{key!r} [{lang}{p}]: empty")
                if lang == "ro" and CEDILLAS.search(v): fail(f"{key!r} [ro{p}]: cedilla ş/ţ in {v!r}, use ș/ț")
                if lang != "en" and v == key and lang not in ALLOW_IDENTICAL.get(key, set()):
                    fail(f"{key!r} [{lang}{p}]: identical to English")
            for name, cats in plural_sets(loc):
                missing = REQUIRED_PLURALS[lang] - cats
                if missing: fail(f"{key!r} [{lang}] plural {name or 'root'}: missing {sorted(missing)}")
            if check_specifiers and not plural_sets(loc) and "stringUnit" in loc:
                if specifiers(loc["stringUnit"]["value"]) != specifiers(key):
                    fail(f"{key!r} [{lang}]: format specifiers differ: {loc['stringUnit']['value']!r}")
    return cat

def check_extracted(derived, catalog):
    files = glob.glob(os.path.join(derived, "Build/Intermediates.noindex/Boolaa.build/*/Boolaa.build/Objects-normal/*/*.stringsdata"))
    if not files: fail(f"no .stringsdata under {derived} (build with SWIFT_EMIT_LOC_STRINGS=YES first)"); return
    code_keys = set()
    for f in files:
        for table, entries in json.load(open(f)).get("tables", {}).items():
            if table == "Localizable": code_keys |= {e["key"] for e in entries}
    cat_keys = set(catalog["strings"])
    for k in sorted(code_keys - cat_keys): fail(f"{k!r}: used in code but missing from Localizable.xcstrings")
    for k in sorted(cat_keys - code_keys): fail(f"{k!r}: in catalog but no longer used in code (stale)")
    print(f"code keys: {len(code_keys)}, catalog keys: {len(cat_keys)}")

def check_bundle(derived, catalog):
    apps = glob.glob(os.path.join(derived, "Build/Products/*-iphonesimulator/Boolaa.app")) + \
           glob.glob(os.path.join(derived, "Build/Products/*-iphoneos/Boolaa.app"))
    if not apps: fail("Boolaa.app not found in derived data"); return
    app = apps[0]
    info = plistlib.load(open(os.path.join(app, "Info.plist"), "rb"))
    if set(info.get("CFBundleLocalizations", [])) != set(ALL_LANGS):
        fail(f"CFBundleLocalizations is {info.get('CFBundleLocalizations')}")
    plural_keys = {k for k, e in catalog["strings"].items() if any(plural_sets(l) for l in e["localizations"].values())}
    simple_keys = set(catalog["strings"]) - plural_keys
    for lang in ALL_LANGS:
        lproj = os.path.join(app, f"{lang}.lproj")
        if not os.path.isdir(lproj): fail(f"{lang}.lproj missing from {app}"); continue
        strings, sdict = {}, {}
        p = os.path.join(lproj, "Localizable.strings")
        if os.path.exists(p): strings = plistlib.load(open(p, "rb"))
        p = os.path.join(lproj, "Localizable.stringsdict")
        if os.path.exists(p): sdict = plistlib.load(open(p, "rb"))
        if lang != "en":
            for k in sorted(simple_keys - set(strings)): fail(f"{lang}.lproj: {k!r} not compiled")
        for k in sorted(plural_keys - set(sdict)): fail(f"{lang}.lproj: plural {k!r} not compiled")
        ip = os.path.join(lproj, "InfoPlist.strings")
        if lang != "en" and (not os.path.exists(ip) or "NSPhotoLibraryUsageDescription" not in plistlib.load(open(ip, "rb"))):
            fail(f"{lang}.lproj: InfoPlist.strings lacks NSPhotoLibraryUsageDescription")
        print(f"{lang}.lproj: {len(strings)} strings, {len(sdict)} plural entries")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--derived-data", help="xcodebuild -derivedDataPath used for the build")
    args = ap.parse_args()
    cat = check_catalog(os.path.join(ROOT, "Boolaa/Resources/Localizable.xcstrings"))
    check_catalog(os.path.join(ROOT, "Boolaa/Resources/InfoPlist.xcstrings"), check_specifiers=False)
    if args.derived_data:
        check_extracted(args.derived_data, cat)
        check_bundle(args.derived_data, cat)
    if errors:
        print("\n".join(f"error: {e}" for e in errors)); print(f"{len(errors)} localization error(s)")
        sys.exit(1)
    print(f"OK: {len(cat['strings'])} keys translated in {', '.join(LANGS)}")

main()
