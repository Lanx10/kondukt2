This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Shipping — always commit, push, and publish

Finished work is not finished until it is committed, pushed, and published —
and each push is verified. Never end a task with uncommitted changes.

1. **Verify first:** `npx tsc --noEmit`, `npx expo lint`, and every test suite
   (`npx tsx src/**/*.test.ts`) must pass before anything is committed.
2. **Commit and push to GitHub** (`origin` → `Lanx10/kondukt2`) with a short
   imperative message matching the repo's style (see `git log`). Push the
   branch: `git push origin master`.
3. **Push the update to Expo (EAS Update — the OTA channel)** for JS/TS-only
   changes. The channel is always `production` (the app pins
   `expo-channel-name: production`):
   ```bash
   npx eas-cli@latest update --channel production --platform android \
     --environment production --non-interactive -m "Describe the change"
   ```
   One-time setup: `npx eas login`, `npx eas init`, `npx eas update:configure`.
   If EAS is not logged in or the publish fails, say so plainly — never claim an
   update shipped when it did not.
4. **Native / `versionCode` changes cannot ship over the air.** Follow the full
   APK release procedure in `RELEASE-WORKFLOW.md`: bump `expo.version` +
   `package.version`, increment `expo.android.versionCode`, build
   (`npx eas build --platform android --profile preview`), and publish a GitHub
   Release tagged `v<semver>` with the `kondukt-<semver>.apk` asset.
5. **Check that every push actually landed:**
   - Git: `git status` is clean and `git log origin/master` matches local.
   - OTA: `npx eas-cli@latest update list` shows the new publish on
     `production`, and on a device Settings → **Interface updates** →
     **Check for Updates** detects it.
   - APK: `curl -s https://api.github.com/repos/Lanx10/kondukt2/releases/latest`
     shows the new tag, APK asset and manifest, and the app's **App updates**
     card detects it.
   - If any check fails, fix it and re-push. A failed publish means the task is
     not done.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
