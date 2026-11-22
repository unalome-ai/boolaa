/**
 * Universal links (iOS) and App Links (Android) for invite links, https://boolaa.ro/join/CODE
 * (docs/boolaa-spec.md, "Invite links"). Served by app/.well-known/* as application/json; the
 * proxy matcher skips /.well-known so no auth check or redirect ever touches them.
 */

/** Apple team W5WKF2N472 + bundle id `ro.boolaa.app` (apps/boolaa-ios/project.yml). */
export const IOS_APP_ID = "W5WKF2N472.ro.boolaa.app";

/** Android applicationId (apps/boolaa-android). */
export const ANDROID_PACKAGE = "ro.boolaa.app";

/**
 * SHA-256 of the release signing certificate (~/.boolaa-signing/boolaa-release.jks, alias
 * `boolaa`). Public: `keytool -list -v` prints it. Debug builds use another key, so App Links
 * verify only for release-signed APKs (debug builds still open the link via the chooser).
 */
export const ANDROID_CERT_SHA256 = [
  "4F:65:12:5D:BF:81:83:E7:10:10:56:2D:86:0C:E6:34:6E:AA:7C:C3:B5:28:4B:97:D0:F0:63:2C:82:8E:D9:C4",
];

/** Paths the apps open. Everything else on boolaa.ro stays in the browser. */
export const APP_LINK_PATHS = ["/join/*"];

export function appleAppSiteAssociation() {
  return {
    applinks: {
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: APP_LINK_PATHS.map((p) => ({ "/": p, comment: "Invite links" })),
        },
      ],
    },
  };
}

export function assetLinks() {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: ANDROID_CERT_SHA256 },
    },
  ];
}
