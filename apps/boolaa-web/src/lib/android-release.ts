import latest from "../../public/android/latest.json";

/**
 * The current Android release: public/android/latest.json, served as-is at /android/latest.json
 * (the update manifest the Android app polls; field names are a fixed contract with
 * apps/boolaa-android) and read here at build time by the /android download page, so the two can
 * never disagree. Release steps: build and sign the APK, upload it to the GitHub release, then fill
 * in url, sha256, size, versionCode / versionName and released in that one file.
 */
export type AndroidRelease = {
  versionCode: number;
  versionName: string;
  /** Older versionCodes must update before they can be used. */
  minSupported: number;
  /** Direct APK download (GitHub release asset). */
  url: string;
  /** SHA-256 of the APK file, hex. */
  sha256: string;
  /** APK size in bytes; 0 = not known yet (the page then hides it). */
  size: number;
  /** SHA-256 of the release signing certificate, colon-separated uppercase (as in assetlinks.json). */
  certSha256: string;
  /** Release date, ISO yyyy-mm-dd. */
  released: string;
};

export const ANDROID_RELEASE: AndroidRelease = latest;

/** Path of the manifest on boolaa.ro. */
export const ANDROID_MANIFEST_PATH = "/android/latest.json";
