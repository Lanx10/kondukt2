# Release Workflow — OTA Updates vs Google Play

Kondukt ships through **two completely separate update channels**. This document is the
source of truth for both. Do not mix them: the app never downloads an APK, never installs
from unknown sources, and never talks to a server other than EAS Update for OTA content.

| | OTA (EAS Update) | Google Play release |
|---|---|---|
| Delivers | JavaScript/TypeScript, UI, business logic, assets, bug fixes | New Android binary (native modules, native config, versionCode bumps) |
| Mechanism | `expo-updates` + EAS Update, fetched in-app | Play Store distributes the AAB; users update through Play |
| Compatibility gate | `runtimeVersion` must match the installed build | `versionCode` / Play track rules |
| Never used for | Installing a new Android binary | Replacing the app's own JS hot-update path |

**The app must never implement:** direct APK downloading, manual APK installation,
unknown-source installs, custom APK replacement, or a second update server for binaries.
If native code changes, Google Play is the only distribution path.

## Version concepts (keep them separate)

| Concept | Source of truth | Current value |
|---|---|---|
| App version (user-facing) | `expo.version` in `app.json` (also `package.json` version) | `1.0.0` |
| Android `versionCode` | `expo.android.versionCode` in `app.json` (`eas.json` sets `appVersionSource: local`) | `1` |
| Expo `runtimeVersion` | `expo.runtimeVersion.policy: "appVersion"` → resolves to the app version | `1.0.0` |
| EAS Update channel | `eas.json` build profiles | `production` / `preview` / `development` |
| Update ID | Per published OTA update, returned by EAS at publish time (shown as `Updates.updateId` when running one) | n/a until first publish |

`runtimeVersion.policy: "appVersion"` means: OTA updates are only delivered to installs
whose app version matches the update's runtime. Bump `expo.version` only for releases
that require it (typically with a new binary); while it stays `1.0.0`, every Play build
of 1.0.0 shares one OTA runtime.

## Configuration status

Present in this project:

- `expo-updates ~57.0.24` (SDK 57-matched, installed via `npx expo install expo-updates`)
- `expo-constants ~57.0.20` (reads the app version for the Settings card)
- `app.json` → `expo.runtimeVersion: { "policy": "appVersion" }`
- `app.json` → `expo.updates.checkAutomatically: "NEVER"` — the app's own throttled
  check owns the cadence (one at start, one per return to foreground, min. 6 h apart),
  so there is exactly one checker and no surprise network calls.
- `eas.json` → channels `development`, `preview`, `production` on the matching profiles.

**One-time setup still required on your EAS account** (values are never invented here):

1. `npx eas login` (an Expo account is required).
2. `npx eas init` — links this repository to an EAS project and writes
   `extra.eas.projectId` into `app.json`. This is the project ID EAS Update serves from.
3. `npx eas update:configure` — writes `expo.updates.url`
   (`https://u.expo.dev/<projectId>`) into `app.json`. Without a URL, OTA is simply
   disabled (`Updates.isEnabled === false`) and the Settings card says so calmly —
   nothing crashes.
4. Verify after step 3 that `expo.updates.checkAutomatically` is still `"NEVER"`
   (the app owns checking; re-add it if the CLI overwrote it).

## OTA JavaScript/UI update (no Play release needed)

1. Modify application code.
2. Test locally (`npx expo start`, `npx expo lint`, `npx tsc --noEmit`, test suites).
3. Build/test the production environment as appropriate — OTA is only valid for a
   **release build** with a configured update URL (`npx eas build --profile production`).
4. Publish to the production channel:
   ```bash
   npx eas update --channel production --message "Describe the change"
   ```
   EAS stamps the update with the current `runtimeVersion` (the app version), so only
   installs speaking that runtime receive it.
5. Users receive it through the in-app mechanism (see below): the next check finds it,
   the user taps **Update Now**, and the app restarts into the new code. Local data
   (trips, tickets, passengers, history, configuration) is untouched — OTA replaces
   code and assets only, never the database.

## Native Android update (Play release)

1. Modify native functionality or dependencies (`npx expo install <pkg>` for native
   modules; regenerate native projects if needed: `npx expo prebuild -p android`).
2. Increment versions according to the release strategy:
   - bump `expo.version` in `app.json` (and `package.json` `version` to match),
   - bump `expo.android.versionCode` in `app.json` (Play requires each upload to
     increase; the current value is `1`).
   - Bumping `expo.version` automatically moves `runtimeVersion` (policy `appVersion`),
     which correctly stops OTA delivery to older binaries.
3. Create a production Android build:
   ```bash
   npx eas build --platform android --profile production
   ```
   (produces the AAB; `eas.json` production profile sets `buildType: app-bundle` and
   `channel: production`).
4. Submit the AAB to Google Play Console (manually or `npx eas submit -p android`).
5. Google Play distributes the new binary; users update through Play. The app performs
   **no** APK download or install of its own.

## How the user triggers an update from the app

- **Automatic (quiet):** on app start and on return to foreground, at most once every
  6 hours, the app checks for an OTA update. If one exists and no ticket/trip-entry
  screen is open, the **"Update available"** sheet appears with **Update Now** and
  **Later**. Automatic checks never restart the app on their own.
- **Manual:** Settings → **App Updates** → **Check for Updates**. The card shows the
  current version/runtime/channel, the last check time, and one of:
  *You're already using the latest version*, *An update is available to download*,
  *Downloading update…*, *Update downloaded (ready)*, an offline/unavailable error, or
  the development-build notice. While an update is downloaded and waiting, the button
  becomes **Restart to Update**.
- A restart into the update happens only on an explicit press. Checks and downloads
  fail soft: the app stays fully usable offline, errors show friendly copy (never stack
  traces), and no local data is ever deleted or reset by updating.

## Guarded moments

`src/lib/updateGuard.ts` — `AddTripScreen` and `AddTicketScreen` register while
mounted. While any is registered, an available update will **not** open its sheet and
a downloaded update will **not** auto-restart. The news waits in the Settings card
until the transaction screen is closed.

## Code map

| File | Role |
|---|---|
| `src/lib/updateState.ts` | Pure rules: phases, throttle, error classification, all copy |
| `src/lib/updateState.test.ts` | Self-check (`npx tsx src/lib/updateState.test.ts`) |
| `src/lib/updateService.ts` | The **only** `expo-updates` import: check/download/apply, single-flight |
| `src/lib/UpdateProvider.tsx` | App-wide state machine + lifecycle (`useUpdates()`) |
| `src/lib/updateGuard.ts` | Workflow guard used by the transaction screens |
| `src/lib/preferences.ts` | Persists the last check timestamp (throttle across restarts) |
| `src/screens/SettingsScreen.tsx` | Update card + "Update available" sheet |

There is exactly one update service and one provider; do not add a second checker.
