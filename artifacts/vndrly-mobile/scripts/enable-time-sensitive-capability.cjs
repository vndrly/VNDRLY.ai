/**
 * Enable Time Sensitive Notifications on com.vndrly.field via ASC API POST
 * (EAS/apple-utils PATCH often reports success without persisting this capability).
 */
const fs = require("fs");
const path = require("path");

const mobileRoot = path.join(__dirname, "..");
const repoRoot = path.join(mobileRoot, "../..");

process.env.EXPO_ASC_API_KEY_PATH =
  process.env.EXPO_ASC_API_KEY_PATH ??
  path.join(repoRoot, ".local/AuthKey_C7YFYCR72K.p8");
process.env.EXPO_ASC_KEY_ID = process.env.EXPO_ASC_KEY_ID ?? "C7YFYCR72K";
process.env.EXPO_ASC_ISSUER_ID =
  process.env.EXPO_ASC_ISSUER_ID ?? "0bb5c187-d2b0-4058-91b2-b1cccccaac53";
process.env.EXPO_APPLE_TEAM_ID = process.env.EXPO_APPLE_TEAM_ID ?? "CM253WWQW2";
process.env.EXPO_APPLE_TEAM_TYPE = process.env.EXPO_APPLE_TEAM_TYPE ?? "INDIVIDUAL";

const easCliRoot = path.dirname(require.resolve("eas-cli/package.json"));
const { authenticateAsync, getRequestContext } = require(path.join(
  easCliRoot,
  "build/credentials/ios/appstore/authenticate",
));
const { AuthenticationMode } = require(path.join(
  easCliRoot,
  "build/credentials/ios/appstore/authenticateTypes",
));
const { getBundleIdForIdentifierAsync } = require(path.join(
  easCliRoot,
  "build/credentials/ios/appstore/bundleId",
));

const BUNDLE_ID = "com.vndrly.field";
const CAPABILITY_TYPE = "USERNOTIFICATIONS_TIMESENSITIVE";
const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";

async function ascFetch(context, method, urlPath, body) {
  const tokenObj = context.token;
  const token =
    typeof tokenObj?.get === "function"
      ? tokenObj.get()
      : typeof tokenObj?.token === "string"
        ? tokenObj.token
        : tokenObj;
  const res = await fetch(`${ASC_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => e.detail || e.title).join("; ") || text;
    throw new Error(`${method} ${urlPath} failed (${res.status}): ${detail}`);
  }
  return json;
}

async function listCapabilities(context, bundleIdResourceId) {
  const json = await ascFetch(
    context,
    "GET",
    `/bundleIds/${bundleIdResourceId}/bundleIdCapabilities`,
  );
  return (json?.data ?? []).map((row) => row.attributes?.capabilityType);
}

async function enableTimeSensitive(context, bundleIdResourceId) {
  const existing = await listCapabilities(context, bundleIdResourceId);
  if (existing.includes(CAPABILITY_TYPE)) {
    console.log("Time Sensitive capability already enabled on Apple.");
    return;
  }

  console.log("POST bundleIdCapabilities (Time Sensitive)…");
  await ascFetch(context, "POST", "/bundleIdCapabilities", {
    data: {
      type: "bundleIdCapabilities",
      attributes: {
        capabilityType: CAPABILITY_TYPE,
        settings: [],
      },
      relationships: {
        bundleId: {
          data: {
            type: "bundleIds",
            id: bundleIdResourceId,
          },
        },
      },
    },
  });
}

async function main() {
  const auth = await authenticateAsync({ mode: AuthenticationMode.API_KEY });
  const context = getRequestContext(auth);
  const bundle = await getBundleIdForIdentifierAsync(context, BUNDLE_ID);
  console.log(`Bundle ID resource: ${bundle.id} (${BUNDLE_ID})`);

  await enableTimeSensitive(context, bundle.id);

  const after = await listCapabilities(context, bundle.id);
  console.log("Capabilities now:", after.join(", "));
  if (!after.includes(CAPABILITY_TYPE)) {
    throw new Error(
      [
        "Time Sensitive cannot be enabled via App Store Connect API key.",
        "In Apple Developer Portal → Identifiers → com.vndrly.field:",
        "enable Time Sensitive Notifications, Save, then re-add to app.json:",
        '  "entitlements": { "com.apple.developer.usernotifications.time-sensitive": true }',
        "and run: node artifacts/vndrly-mobile/scripts/refresh-ios-appstore-provisioning.cjs",
      ].join("\n"),
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
