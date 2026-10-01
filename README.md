# Kondukt

Expo (SDK 57) / React Native Android app for bus fare and trip management —
offline-first, distributed as a **direct APK** (no Google Play).

- **APK updates:** GitHub Releases (`Lanx10/kondukt2`), downloaded and installed
  in-app through Android's normal installer.
- **Interface updates:** optional EAS Update (OTA) channel for JS-only changes.

Full release process, updater behavior and troubleshooting live in
[RELEASE-WORKFLOW.md](RELEASE-WORKFLOW.md).

## Quick start

```bash
npx expo start          # dev server
npx tsc --noEmit        # typecheck
npx expo lint           # lint
npx expo export --platform web   # build validation
```

Tests are dependency-free self-checks:

```bash
for f in src/lib/*.test.ts src/data/*.test.ts; do npx -y tsx "$f" || break; done
```

## How releases are created & APKs uploaded

1. Bump `expo.version` in `app.json` (and `package.json` `version` to match).
2. Increment `expo.android.versionCode` in `app.json` — **every** release must increase.
3. Test (typecheck, lint, suites, device pass).
4. Build the APK: `npx eas build --platform android --profile preview`.
5. Create a GitHub Release on `Lanx10/kondukt2`, tag `v<semver>` (`v1.1.0`, `v1.2.0`, …).
6. Attach exactly one asset named `kondukt-<semver>.apk` (e.g. `kondukt-1.1.0.apk`).
7. Put release notes in the body — plain lines, or the optional JSON manifest
   (`version`, `versionCode`, `minimumVersion`, `apkUrl`, `releaseNotes`, `sha256`).
8. Publish; verify with
   `curl -s https://api.github.com/repos/Lanx10/kondukt2/releases/latest`.

## How users receive updates

The app checks the latest GitHub release automatically at start-up and on returning to
foreground, at most once every 6 hours, plus manually via
**Settings → App updates → Check for Updates**. When a newer release exists the user
sees version, notes and file size, taps **Update Now**, watches the download percentage,
and approves Android's install prompt. Local data (trips, tickets, passengers, history,
configuration) is never touched.

**Mandatory updates:** only when the release body sets `minimumVersion` above the
installed version (and `allowMandatoryUpdates` is on) — then the sheet shows
*Update required* with no **Later** button.

## Testing the updater

- Pure logic: `npx -y tsx src/lib/apkUpdateState.test.ts` (semver ordering including
  `1.10.0 > 1.9.0`, malformed metadata, trusted-URL enforcement, verdicts, throttle,
  copy).
- End-to-end on a device: publish a release with a higher version, install the previous
  APK, open Settings → App updates → Check for Updates → **Update Now** → install →
  confirm version and data.
- Offline: airplane mode — automatic checks are silent, manual checks show friendly
  copy, every screen keeps working.
- Rate limiting: repeated manual checks hit GitHub's unauthenticated limit; the card
  shows the friendly "too many requests" line after a few minutes' wait.

## Troubleshooting

- **Failed downloads:** partial files are auto-deleted; retry on stable internet.
  Detail is in logcat under `[apk-update]`.
- **Android installation permission:** tap **Open Settings** in the
  *Installation permission required* sheet → enable *Install from this source* for
  Kondukt → return → **Install Update**. (Or: Settings → Apps → Kondukt → Install
  unknown apps.)
- **No release detected:** the repo must be public, the tag must be `v<semver>`, and a
  `.apk` asset must be attached. Drafts/pre-releases are ignored.

## Configuration

All updater settings are centralized in `src/lib/apkUpdateConfig.ts`
(`UPDATE_CONFIG`): GitHub owner/repository, tag prefix, auto-check interval,
mandatory-update switch, request timeout. No secrets — the repo is public and the app
never authenticates against GitHub.
