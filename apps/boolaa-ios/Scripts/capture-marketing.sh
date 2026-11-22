#!/bin/bash
# Regenerates the landing-page screenshots (apps/boolaa-web/public/screens/<locale>/<theme>/<screen>.webp)
# from the iOS app in the simulator, against the LOCAL Supabase.
#
#   Scripts/capture-marketing.sh                      all 5 languages, light and dark
#   LOCALES="en ro" THEMES=light Scripts/capture-marketing.sh
#   SCREENS="home chat" SKIP_BUILD=1 Scripts/capture-marketing.sh
#   SIM_UDID=<udid> Scripts/capture-marketing.sh      pick the simulator (default: the first booted one)
#
# Needs: Xcode, xcodegen, psql, python3, cwebp (brew install webp) and `supabase start`.
# The fictional data comes from Scripts/marketing/ (content.json, seed.py). It is loaded per language
# and deleted again when the script exits, so the normal seed stays as it was.
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_SCREENS="$IOS_DIR/../boolaa-web/public/screens"
SEED="$IOS_DIR/Scripts/marketing/seed.py"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:55322/postgres}"
LOCALES="${LOCALES:-en ro fr es it}"
THEMES="${THEMES:-light dark}"
SCREENS="${SCREENS:-home chat events food market links settings requests join create pending}"
WIDTH="${WIDTH:-660}"      # output width in px (the simulator renders 1206); shown at up to 330 CSS px
QUALITY="${QUALITY:-80}"
BUNDLE_ID=com.boolaa.app
DERIVED="$IOS_DIR/build/MarketingDerivedData"
RAW="${RAW_DIR:-$(mktemp -d)}"

# Safety: only ever a local database and a local backend.
case "$DB_URL" in *@127.0.0.1:*|*@localhost:*) ;; *) echo "DB_URL must be a local database" >&2; exit 1 ;; esac
grep -Eq '^SUPABASE_URL *= *http:/\$\(\)/(127\.0\.0\.1|localhost)' "$IOS_DIR/Config/Local.xcconfig" \
  || { echo "Config/Local.xcconfig must point SUPABASE_URL at the local Supabase" >&2; exit 1; }
psql -q "$DB_URL" -c 'select 1' >/dev/null || { echo "Local Supabase is not running (supabase start)" >&2; exit 1; }

SIM="${SIM_UDID:-$(xcrun simctl list devices booted | grep -Eo '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}' | head -1)}"
[ -n "$SIM" ] || { echo "Boot an iPhone simulator or set SIM_UDID" >&2; exit 1; }
xcrun simctl bootstatus "$SIM" -b >/dev/null

if [ -z "${SKIP_BUILD:-}" ]; then
  (cd "$IOS_DIR" && xcodegen generate >/dev/null && xcodebuild -project Boolaa.xcodeproj -scheme Boolaa -configuration Debug \
     -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath "$DERIVED" build -quiet)
fi
xcrun simctl install "$SIM" "$DERIVED/Build/Products/Debug-iphonesimulator/Boolaa.app"

sql() { psql -q -v ON_ERROR_STOP=1 "$DB_URL" >/dev/null; }
finish() {
  python3 "$SEED" --cleanup | sql || echo "Clean-up failed: run 'python3 $SEED --cleanup | psql \$DB_URL'" >&2
  xcrun simctl terminate "$SIM" "$BUNDLE_ID" 2>/dev/null || true
  xcrun simctl status_bar "$SIM" clear || true
  xcrun simctl ui "$SIM" appearance light || true
}
trap finish EXIT

xcrun simctl status_bar "$SIM" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3

region() { case "$1" in en) echo en_GB ;; *) echo "$1_$(echo "$1" | tr a-z A-Z)" ;; esac; }

# The marketing rows are all there, in this language. False while (or after) someone runs `supabase db reset`.
intact() {
  [ "$(psql -At "$DB_URL" -c "select count(*) from public.bubble_members m join public.bubbles b on b.id = m.bubble_id
        join public.join_requests r on r.bubble_id = b.id where b.invite_code = '$code' and b.name = \$\$$flat\$\$" 2>/dev/null)" = 4 ]
}
reseed() {
  until python3 "$SEED" "$1" | sql 2>/dev/null; do sleep 3; done
}

# shot <locale> <theme> <screen> <seconds to settle> <launch arguments...>
# Retaken (after loading the data again) if the database was reset under it.
shot() {
  local locale=$1 theme=$2 screen=$3 settle=$4 attempt; shift 4
  mkdir -p "$RAW/$locale/$theme" "$WEB_SCREENS/$locale/$theme"
  for attempt in 1 2 3 4; do
    intact || { echo "  data missing, loading it again" >&2; reseed "$locale"; settle=8; }
    xcrun simctl terminate "$SIM" "$BUNDLE_ID" 2>/dev/null || true
    xcrun simctl launch "$SIM" "$BUNDLE_ID" -AppleLanguages "($locale)" -AppleLocale "$(region "$locale")" "$@" >/dev/null
    sleep "$settle"
    xcrun simctl io "$SIM" screenshot "$RAW/$locale/$theme/$screen.png" >/dev/null 2>&1
    intact && break
    [ "$attempt" = 4 ] && { echo "The database keeps changing under the capture; giving up on $locale/$theme/$screen" >&2; exit 1; }
  done
  cwebp -quiet -resize "$WIDTH" 0 -q "$QUALITY" -m 6 "$RAW/$locale/$theme/$screen.png" -o "$WEB_SCREENS/$locale/$theme/$screen.webp"
  echo "  $locale/$theme/$screen.webp"
}

for locale in $LOCALES; do
  flat="$(python3 "$SEED" --get "$locale" flat)"
  about="$(python3 "$SEED" --get "$locale" flat-description)"
  code="$(python3 "$SEED" --get "$locale" code)"
  reseed "$locale"
  alice=(-UITestAutoLogin mk-alice@boolaa.test -UITestBubble "$flat")
  first=8   # the first launch signs in and downloads the photos
  for theme in $THEMES; do
    xcrun simctl ui "$SIM" appearance "$theme"
    for screen in $SCREENS; do
      case "$screen" in
        home)     shot "$locale" "$theme" home "$first" "${alice[@]}" -UITestTab home; first=5 ;;
        chat)     shot "$locale" "$theme" chat 5 "${alice[@]}" -UITestOpen chat ;;
        events)   shot "$locale" "$theme" events 5 "${alice[@]}" -UITestTab events ;;
        food)     shot "$locale" "$theme" food 8 "${alice[@]}" -UITestTab food ;;
        market)   shot "$locale" "$theme" market 8 "${alice[@]}" -UITestTab marketplace ;;
        links)    shot "$locale" "$theme" links 5 "${alice[@]}" -UITestOpen links ;;
        settings) shot "$locale" "$theme" settings 5 "${alice[@]}" -UITestTab settings ;;
        requests) shot "$locale" "$theme" requests 6 "${alice[@]}" -UITestTab settings -UITestScrollTo requests ;;
        join)     shot "$locale" "$theme" join 8 -UITestAutoLogin mk-finn@boolaa.test -UITestOnboarding join -UITestJoinCode "$code" ;;
        create)   shot "$locale" "$theme" create 5 -UITestAutoLogin mk-finn@boolaa.test -UITestOnboarding create -UITestBubbleName "$flat" -UITestBubbleDescription "$about" ;;
        pending)  shot "$locale" "$theme" pending 7 -UITestAutoLogin mk-erin@boolaa.test ;;
        *) echo "Unknown screen: $screen" >&2; exit 1 ;;
      esac
    done
  done
done

echo "Raw PNGs: $RAW"
du -sh "$WEB_SCREENS" | awk '{print "Web assets: " $1 " in " $2}'
