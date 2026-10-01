# Release Workflow — GitHub Releases (APK) vs EAS Update (OTA)

Kondukt ships as a **directly distributed APK** — there is no Google Play release.
Two separate update channels exist, and this document is the source of truth for both:

| | APK (GitHub Releases) — **primary** | OTA (EAS Update) — secondary |
|---|---|---|
| Delivers | The full Android binary (native modules, config, versionCode bumps) | JavaScript/TypeScript, UI, business logic, assets |
| Mechanism | In-app download from this repo's GitHub Releases + Android's normal installer | `expo-updates` + EAS Update, fetched in-app |
| Compatibility gate | Semver compare + optional `versionCode` / `minimumVersion` | `runtimeVersion` must match the installed build |
| Never used for | Replacing JS hot-update as the *only* path | Installing a new Android binary |

The two systems are visible side by side in Settings → App Updates: **App updates**
(GitHub Releases APK) and **Interface updates** (OTA). Neither uses Google Play. The
app never embeds credentials of any kind: GitHub Releases are public and need no token.

## GitHub release structure (the version manifest)

The app's single source of truth for "what is the latest release?" is
`GET https://api.github.com/repos/<owner>/<repo>/releases/latest` — GitHub's own
latest-release metadata. The release itself is the manifest:

```
GitHub Repository (Lanx10/kondukt2)
└── Releases
    ├── v1.0.0
    │   └── kondukt-1.0.0.apk
    ├── v1.1.0
    │   └── kondukt-1.1.0.apk
    └── v1.2.0
        └── kondukt-1.2.0.apk
```

- **Tag** `v<semver>` → the released version (`v1.2.0` → `1.2.0`).
- **Asset** `kondukt-<semver>.apk` → the file to download. The name is derived from
  release metadata at runtime; the app never hardcodes a filename. The asset URL must
  live under `https://github.com/<owner>/<repo>/releases/download/` or it is rejected.
- **Release body (optional JSON manifest)** — parsed only when the body is a JSON
  object; otherwise the body's lines become the release notes shown in the sheet:

```json
{
  "version": "1.2.0",
  "versionCode": 12,
  "minimumVersion": "1.0.0",
  "apkUrl": "https://github.com/Lanx10/kondukt2/releases/download/v1.2.0/kondukt-1.2.0.apk",
  "releaseNotes": [
    "Improved ticket entry",
    "Fixed trip history",
    "Performance improvements"
  ],
  "sha256": "<64 hex chars of the APK, optional>"
}
```

`minimumVersion` and `sha256` exist **only** in this body manifest — GitHub's API
cannot express them. All fields are optional except that *some* valid version source
(tag or `version`) and *some* trusted APK URL (asset preferred) must resolve.

## Version concepts (keep them separate)

| Concept | Source of truth | Current value |
|---|---|---|
| App version (user-facing, compared to release tags) | `expo.version` in `app.json` (`package.json` version matches) | `1.0.2` |
| Android `versionCode` | `expo.android.versionCode` in `app.json` (`eas.json` has `appVersionSource: local`) | `4` |
| Expo `runtimeVersion` | `expo.runtimeVersion` — a **stable custom string**, deliberately *not* the app version | `1.0.2` |
| EAS Update channel | `eas.json` build profiles | `production` / `preview` / `development` |
| Updater configuration | `src/lib/apkUpdateConfig.ts` (`UPDATE_CONFIG`) | owner `Lanx10`, repo `kondukt2`, tag prefix `v`, 6 h auto-check, mandatory allowed |

Version comparison is numeric per semver segment (`1.10.0 > 1.9.0`), malformed input
never crashes or forces an update, and a released `versionCode` above the installed one
breaks equal-version ties. Mandatory updates happen **only** when the release body sets
`minimumVersion` above the installed version **and** `allowMandatoryUpdates` is true —
an update merely existing is never forced.

## APK release procedure (exact)

1. Update the application code.
2. Update the application version: `expo.version` in `app.json` + `package.version`
   (keep them equal).
3. Increment `expo.android.versionCode` in `app.json` (every release must increase).
4. Test: `npx tsc --noEmit`, `npx expo lint`, the test suites
   (`npx -y tsx src/lib/apkUpdateState.test.ts` and the rest under `src/lib/*.test.ts`,
   `src/data/*.test.ts`), then manual passes on a device.
5. Build the production APK:
   ```bash
   npx eas build --platform android --profile preview
   ```
   `eas.json`'s `preview` profile produces an APK (channel `preview`, `buildType: apk`).
   Native config changes (new permissions, native modules) need
   `npx expo prebuild -p android` first if the `android/` directory is stale.
6. Create a GitHub Release on `Lanx10/kondukt2` (web UI or `gh release create`).
7. Tag it with the project convention: `v<semver>` — `v1.1.0`, `v1.2.0`, `v1.3.0`.
   Never reuse a tag; never tag a draft as final until the APK is attached.
8. Upload exactly one APK asset named `kondukt-<semver>.apk`
   (e.g. `kondukt-1.1.0.apk`).
9. Paste the release notes as the body — plain lines, or the JSON manifest above when
   you need `minimumVersion` / `sha256` / `versionCode`.
10. Publish the release, then verify the endpoint:
    ```bash
    curl -s https://api.github.com/repos/Lanx10/kondukt2/releases/latest
    ```
    Confirm `tag_name`, the `.apk` asset, and (if used) that the body parses as JSON.
11. Install the previous version on a test device.
12. Open the application (or Settings → App updates → Check for Updates — manual
    checks bypass the 6 h throttle).
13. Verify the newer version is detected (sheet shows new version + notes + size).
14. Tap **Update Now**; verify download progress and percentage.
15. Verify Android's installer prompt appears and the install completes.
16. Verify existing local data (tickets, trips, passengers, history, fare/terminal/
    barangay configuration) remains intact — installing an APK never touches
    `kondukt.db`.
17. Launch the updated app; verify version reporting and that Settings shows
    *You're already using the latest version.*

## How the user experiences updates (APK channel)

- **Automatic (quiet):** on app start and on return to foreground, at most once every
  6 hours (`UPDATE_CONFIG.automaticCheckIntervalMs`), the app asks GitHub for the latest
  release. Failures (offline, rate limit, no release) are logged and swallowed — an
  offline device never sees update errors, and the app stays fully usable.
- **Notification:** if a newer release exists and no transaction screen is open, the
  *Update available* (or *Update required*) sheet appears with new version, release
  notes, file size, **Later** (hidden when mandatory) and **Update Now**.
- **Manual:** Settings → **App updates** → **Check for Updates** (always allowed,
  ignores the throttle).
- **Download → verify → install:** *Update Now* downloads with a live percentage,
  verifies the file (exists, exact GitHub asset size, ZIP/APK magic bytes, optional
  SHA-256 from the manifest), then launches Android's normal installer. Failures delete
  the bad file and show friendly copy; the card's button becomes **Install Update**
  once a verified file waits.
- **Unknown sources:** if Android blocks the install, the *Installation permission
  required* sheet explains and offers **Open Settings** (the per-app
  "Install unknown apps" screen). The user grants it; returning to the app shows
  **Install Update** again. Nothing is ever auto-granted.
- **Guards:** while a transaction screen is registered
  (`src/lib/updateGuard.ts`), no sheet pops automatically and nothing downloads —
  the news waits on the Settings card.

## OTA JavaScript/UI update (secondary channel)

Still available for JS-only changes (no native/`versionCode` delta):

1. Modify application code; test locally.
2. Publish: `npx eas update --channel production --message "Describe the change"`
   (requires the one-time EAS setup: `npx eas login`, `npx eas init`,
   `npx eas update:configure` — see the Configuration status list below).
3. Users receive it through **Interface updates** in Settings: throttled check,
   **Update Now** restarts into the new code. Local data is untouched.

EAS Update is **never** a substitute for the APK channel: native changes require a new
APK release on GitHub. `app.json` keeps `updates.checkAutomatically: "ON_LOAD"` —
expo-updates checks at every launch, and the app's throttled Settings check remains
the on-demand path for both channels.

### Configuration status (OTA)

- `expo-updates ~57.0.24`, `expo-constants ~57.0.20` installed.
- `expo.runtimeVersion` is a **fixed string** (`1.0.2`), not the `appVersion` policy. Under `appVersion` each release was pinned to its own OTA runtime (`1.0.1` vs `1.0.2` vs …), so a JavaScript fix could never reach a build that had already shipped — which is exactly how the broken 1.0.1 APK verifier became unrepairable over the air. A fixed runtime keeps every build on the same native baseline on one channel; bump it **only** when native code changes.
- `expo.updates.checkAutomatically: "ON_LOAD"`.
- One-time on your EAS account: `npx eas login`, `npx eas init` (writes
  `extra.eas.projectId`), `npx eas update:configure` (writes
  `expo.updates.url`). Without them OTA is simply disabled and its card says so
  calmly — nothing crashes.

### Repairing installs stranded on an old runtimeVersion

A build only accepts updates whose `runtimeVersion` matches the value baked into
that build. Before the runtime became a fixed string, `appVersion` policy baked each
release its own value (`1.0.1` → `"1.0.1"`, `1.0.2` → `"1.0.2"`), so an already
shipped build can never be handed a JavaScript fix under the new stable runtime. To
repair one, publish once against *its* runtime: temporarily set `expo.runtimeVersion`
in `app.json` to that build's baked value, publish, then restore the stable value.

```bash
# rescue the 1.0.1 installs whose APK verifier crashes on an 84 MB file:
#   1. set "runtimeVersion": "1.0.1" in app.json
#   2. publish
npx eas-cli@latest update --channel production --platform android \
  --environment production --non-interactive -m "Rescue: fixed APK verifier"
#   3. restore "runtimeVersion": "1.0.2"
```

`eas update` has no runtime-version flag — the value is read from the app config at
publish time, so the temporary edit *is* the mechanism. Delivery depends only on
`runtimeVersion`; the app pins `expo-channel-name: production` in its request
headers, so every build listens on the `production` channel whatever build profile
produced it.

## Code map

| File | Role |
|---|---|
| `src/lib/apkUpdateConfig.ts` | **Single** updater config: owner, repo, tag prefix, throttle, mandatory switch |
| `src/lib/apkUpdateState.ts` | Pure rules: semver, release parsing, verdict, phases, throttle, all copy |
| `src/lib/sha256.ts` | Streaming SHA-256 (chunked); `expo-crypto`'s `digest` needs the whole file in one buffer and an 84 MB APK does not fit |
| `src/lib/apkUpdateState.test.ts` | Self-check (`npx tsx src/lib/apkUpdateState.test.ts`) |
| `src/lib/apkUpdateService.ts` | GitHub fetch / download / verify / install, single-flight, trusted-URL gate |
| `src/lib/ApkUpdateProvider.tsx` | App-wide APK state machine + lifecycle (`useApkUpdates()`) |
| `src/lib/updateState.ts` | Pure rules for the OTA channel |
| `src/lib/updateService.ts` | The **only** `expo-updates` import |
| `src/lib/UpdateProvider.tsx` | OTA state machine (`useUpdates()`) |
| `src/lib/updateGuard.ts` | Workflow guard shared by both channels |
| `src/lib/preferences.ts` | Persists each channel's last-check timestamp |
| `src/screens/SettingsScreen.tsx` | Both update cards + their sheets |
| `app.json` | version / versionCode / `REQUEST_INSTALL_PACKAGES` |

## Troubleshooting

**No update detected**
- Check the endpoint (step 10): is there a published release with a valid `v<semver>`
  tag? Drafts and pre-releases are ignored by GitHub's `/releases/latest`.
- Is the asset `.apk` and under this repository's `releases/download/`? Foreign URLs
  are rejected by design.
- Manual check bypasses the 6 h throttle: Settings → App updates → Check for Updates.
- Installed version ahead of the release (local dev build) reports *up to date*.

**Download fails / interrupted**
- Partial files are deleted automatically; tap **Update Now** again on a stable
  connection. The status line shows friendly copy only — the log has the detail
  (`[apk-update] download failed (...)`).
- Repeated 403/429 from GitHub = rate limiting: wait (manual checks count too).

**Verification failed**
- The file is deleted and never installed. Re-download. If it persists, the uploaded
  asset does not match its GitHub size (corrupt upload) — re-upload the APK to the
  release; with `sha256` in the manifest, check the digest matches the file.

**"Installation permission required"**
- Android 8+ blocks installs from apps the user hasn't authorized. Tap **Open Settings**
  → enable **Install from this source** for Kondukt → return → **Install Update**.
  If the settings screen does not open, enable it manually:
  Settings → Apps → Kondukt → Install unknown apps.
- Some devices wipe this choice on update; it is a per-install grant, never stored by
  the app.

**Install prompt opens then closes / installer error**
- The verified file may have been evicted from cache (low storage): tap
  **Install Update** → if it re-downloads, storage cleared it. Keep enough free space
  for one full APK copy.

## Security notes

- No GitHub tokens, passwords, or private-repo credentials in the app — the repo must
  stay **public** or the updater cannot work (and embedding credentials would ship
  them to every user).
- Download URLs are rejected unless they are release assets of the configured
  repository; the updater never falls back to another host.
- Downloads live in the app cache and are deleted on failure or after verification
  failure. Nothing else in storage is touched; the SQLite database is never deleted,
  migrated away from, or reset by an update.
