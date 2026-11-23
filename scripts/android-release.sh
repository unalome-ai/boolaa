#!/usr/bin/env bash
# Builds the signed release APK for boolaa.ro/android.
#   scripts/android-release.sh <versionCode> <versionName>
# Secrets never touch disk or the terminal: the keystore password comes from the macOS Keychain
# (`boolaa-android-keystore`), the production anon key from the DigitalOcean web app env (public key, same as the web).
# Prints the APK path, size and SHA-256 for apps/boolaa-web/public/android/latest.json.
set -euo pipefail
CODE="${1:?versionCode}"; NAME="${2:?versionName}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; AND="$ROOT/apps/boolaa-android"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"

BOOLAA_KEYSTORE_PASSWORD="$(security find-generic-password -s boolaa-android-keystore -w)"
export BOOLAA_KEYSTORE_PASSWORD
RELEASE_SUPABASE_ANONKEY="$(doctl apps spec get "${BOOLAA_DO_APP:-524fb8aa-4676-498b-a094-3ddac0241055}" --format json \
  | jq -r '.services[0].envs[] | select(.key=="NEXT_PUBLIC_SUPABASE_ANON_KEY") | .value')"
[ "${#RELEASE_SUPABASE_ANONKEY}" -gt 30 ] || { echo "no production anon key" >&2; exit 1; }
export RELEASE_SUPABASE_ANONKEY
[ -f "$AND/app/google-services.json" ] || cp "$HOME/.boolaa-signing/google-services.json" "$AND/app/google-services.json"

cd "$AND"
# build.gradle.kts reads boolaa.versionCode / boolaa.versionName from local.properties or these env vars.
BOOLAA_VERSIONCODE="$CODE" BOOLAA_VERSIONNAME="$NAME" ./gradlew -q :app:assembleRelease
APK_IN="$AND/app/build/outputs/apk/release/app-release.apk"
OUT="$AND/app/build/outputs/apk/release/boolaa-$NAME.apk"
cp "$APK_IN" "$OUT"

BT="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
"$BT/apksigner" verify --print-certs "$OUT" | grep -E "Signer #1 certificate (DN|SHA-256)"
"$BT/aapt2" dump badging "$OUT" | sed -n 1p || true
echo "apk: $OUT"
echo "size: $(stat -f%z "$OUT")"
echo "sha256: $(shasum -a 256 "$OUT" | cut -d' ' -f1)"
