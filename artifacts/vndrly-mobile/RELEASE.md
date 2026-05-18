# Mobile Release Runbook — TestFlight & Google Play Internal Testing

This document is the step-by-step process for shipping a build of the VNDRLY
field app to Apple TestFlight and the Google Play Internal Testing track.

The project is **already configured** for EAS Build and EAS Submit. Everything
below has to be run from a machine where you can interactively log in to your
own Apple, Google, and Expo accounts — it cannot run unattended in this
sandbox.

Bundle id (both platforms): `com.vndrly.field`

---

## 0. One-time prerequisites

You must have:

1. **Apple Developer Program** membership ($99/yr).
   - In **App Store Connect**, create a new app:
     - Platform: iOS
     - Bundle ID: `com.vndrly.field` (register it under **Certificates, IDs & Profiles** first if it does not yet exist)
     - SKU: `vndrly-field-ios`
     - Name: `VNDRLY Field`
   - Note the **Apple ID email**, the **App Store Connect App ID** (a number, e.g. `6451234567`), and your **Apple Team ID** (10-character string).

2. **Google Play Console** account ($25 one-time).
   - Create a new app `VNDRLY Field` with package `com.vndrly.field`.
   - Manually upload **one** signed AAB to the Internal Testing track first (Google requires this before the API can submit). After that, EAS Submit can take over.
   - Create a service account with the **Service Account User** role and grant it **Release manager** access in Play Console → Users and permissions. Download its JSON key and save it as `artifacts/vndrly-mobile/google-play-service-account.json` (already in `.gitignore`).

3. **Expo account** at https://expo.dev (free tier is fine for the first builds).

4. Push notification credentials:
   - **iOS**: an APNs Auth Key (`.p8`) from the Apple Developer portal. EAS will prompt to upload it on first iOS build.
   - **Android**: nothing extra; Expo push uses FCM v1 via your Google service account, which EAS sets up automatically.

---

## 1. Install the EAS CLI and log in

From `artifacts/vndrly-mobile/`:

```bash
pnpm install                     # picks up the eas-cli devDependency
pnpm eas:login                   # interactive — your Expo username + password
```

## 2. Initialize the EAS project (once)

```bash
pnpm eas:init
```

This creates an Expo project on the EAS servers and writes
`expo.extra.eas.projectId` into `app.json`. The push-notification code in
`lib/push.ts` already reads that value via
`Constants.expoConfig?.extra?.eas?.projectId`, so nothing else needs to change.

Commit the updated `app.json` after this step.

## 3. Fill in submit credentials

Open `eas.json` and replace the three iOS placeholders under
`submit.production.ios`:

- `appleId` — the Apple ID email of an account with access to the app
- `ascAppId` — the numeric App Store Connect App ID from step 0
- `appleTeamId` — your 10-character Apple Team ID

Drop the Google Play service-account JSON at
`artifacts/vndrly-mobile/google-play-service-account.json`.

## 4. Build

iOS (cloud build, ~20 min):

```bash
pnpm eas:build:ios
```

Android (cloud build, ~20 min):

```bash
pnpm eas:build:android
```

Or both at once:

```bash
pnpm eas:build:all
```

On the first iOS build, EAS will offer to generate a Distribution Certificate
and Provisioning Profile for you — accept. It will also prompt for the APNs
`.p8` key; upload it so push notifications work in production.

On the first Android build, EAS will generate an upload keystore. Accept and
let EAS manage it.

## 5. Submit

After each successful build:

```bash
pnpm eas:submit:ios       # → TestFlight
pnpm eas:submit:android   # → Play Console → Internal testing (draft)
```

TestFlight processing typically takes 5–15 minutes. Once it goes from
"Processing" to "Ready to Test", add internal testers in App Store Connect.

In Play Console, open the Internal testing release that EAS created as a draft
and click **Review release → Start rollout to Internal testing**.

## 6. Verify push notifications on real hardware

1. Install the TestFlight build on a physical iPhone and the Internal Testing
   build on a physical Android device.
2. Sign in as a field employee. The app should call `registerForPushNotifications()`
   and POST an Expo push token to `/api/field/push-token`.
3. From the API server, send a test notification to that token via
   <https://exp.host/--/api/v2/push/send>. The device should receive it within
   a few seconds in the background, foreground, and locked states.

If iOS receives nothing, the most common cause is that the APNs `.p8` key
was not uploaded — re-run `eas credentials` and add it.

## 7. Subsequent releases

Bump `expo.version` in `app.json` for user-visible version changes; the
`autoIncrement: true` setting in `eas.json` handles `buildNumber` /
`versionCode` automatically. Then repeat steps 4 and 5.

---

## 8. Over-the-air (OTA) updates with EAS Update

Most fixes are JavaScript-only and don't need a new TestFlight or Play
submission. EAS Update lets us push those fixes to already-installed devices
in seconds.

### One-time setup

1. After running `pnpm eas:init` (step 2), copy the generated
   `expo.extra.eas.projectId` value and replace
   `REPLACE_WITH_EAS_PROJECT_ID` in `app.json` under `expo.updates.url` with
   that id (the URL becomes `https://u.expo.dev/<projectId>`).
2. Run `pnpm exec eas update:configure` once from `artifacts/vndrly-mobile/`
   to register the project with the Update service. This only needs to happen
   the first time.
3. Build and submit to the stores at least once after enabling Updates so the
   installed binary contains the `expo-updates` runtime.

The `production` and `preview` channels in `eas.json` already match update
branches of the same name, so production builds pull production updates and
internal preview builds pull preview updates.

### Publishing an OTA update

From `artifacts/vndrly-mobile/`:

```bash
pnpm eas:update              # publishes to the production channel
pnpm eas:update:preview      # publishes to the preview channel for QA first
```

You will be prompted for a short message; use the commit subject or a
human-readable summary. Devices on the matching channel and `runtimeVersion`
will download the update on next launch.

### When to ship an OTA update vs a new store build

Use **`pnpm eas:update`** (OTA, takes ~30 seconds, no review) when the change
is **JavaScript / asset only**:

- Bug fixes in TSX/TS code under `app/`, `components/`, `hooks/`, `lib/`
- Copy / translation / styling tweaks
- New images or fonts under `assets/`
- API client changes that don't add new native permissions

Use a **full store build** (steps 4 + 5, takes hours and goes through review)
when **any** of the following is true:

- `expo.version` in `app.json` changes (the `appVersion` runtime policy makes
  every store version its own update lane — old installs cannot pull a new
  version's JS bundle)
- A native module is added, removed, or upgraded (anything in `dependencies` /
  `devDependencies` that ships native code, e.g. `expo-camera`,
  `expo-notifications`, `expo-secure-store`, `expo-updates` itself, or any new
  `react-native-*` package)
- A new permission, plugin, URL scheme, or entry in `ios.infoPlist` /
  `android.permissions` / `expo.plugins` is added
- The Expo SDK version is bumped
- App icon, splash screen, bundle id, or signing config changes

If you're not sure, ship a store build. An OTA update that depends on missing
native code will crash the app on launch.

### Rolling back a bad OTA update

```bash
pnpm exec eas update:republish --branch production
```

Pick the previous good update from the list. Devices will pull it on next
launch.

