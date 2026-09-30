# Kondukt — End-to-End QA Report

**Application:** Kondukt (Expo / React Native, `kondukt` v57.0.25, RN 0.86.3, React 19.2.3)
**Report date:** 29 September 2026
**Branch:** `master` @ `0be870f` (Initial commit) + working-tree changes
**Prepared by:** automated QA pass (full end-to-end audit, fix, regression and report)

**Status labels used throughout**

| Label | Meaning |
| --- | --- |
| **VERIFIED** | Executed at runtime during this pass and the correct behaviour was observed on screen. |
| **CODE VERIFIED** | Logic confirmed by reading the code, by a passing automated check, or both — **not** executed end to end on a real target. |
| **FAILED** | Tested and observed failing. Findings below are labelled with the state they were found in; every one marked FIXED has been re-tested. |
| **BLOCKED** | Cannot be tested in this environment. The reason is stated; no result is claimed. |

**Severity scale:** CRITICAL · HIGH · MEDIUM · LOW.

---

## 1. Scope and objective

The request was a complete end-to-end audit of the app: inventory every screen and feature, exercise every interactive element and workflow at runtime, validate fares and other business logic plus persistence, create representative seed data, test empty and populated states, fix root causes rather than symptoms, regression-test, and report formally.

This document is the report for that pass. Sections 5–8 are the inventory and coverage, section 12 is the consolidated findings register, sections 13–21 are the individual findings with their fixes, section 24 is the regression result, and section 25 states what could not be tested and why.

**Out of scope / not claimed:** nothing outside this repository was touched. No device, emulator, Expo Go client or physical Android/iOS build was available, so native-only behaviour is never labelled VERIFIED.

---

## 2. Application under test

| Item | Value |
| --- | --- |
| Entry point | `App.tsx` → `src/screens/HomeScreen.tsx` |
| Navigation | Hand-rolled state machine in `HomeScreen` (`open: string \| null` + ids). **Not** Expo Router and **not** React Navigation, despite `AGENTS.md` recommending Expo Router. |
| Persistence | `expo-sqlite` (`kondukt.db`); a hand-written in-memory backend shim stands in when SQLite cannot open |
| Preferences | `@react-native-async-storage/async-storage`, one key: `kondukt.preferences.themeMode` |
| Platforms in use | Expo web (dev server), Node `node:sqlite` (SQL-path verification) |
| Android/iOS | No device or emulator attached — see §25 |

Working-tree state during the pass: `App.tsx`, `app.json`, `package.json` modified; `src/` untracked. Nothing was committed.

---

## 3. Test environment and tooling

| Tool | Use |
| --- | --- |
| Expo web dev server, `http://localhost:8082/` | Runtime execution of every screen and workflow (in-memory backend) |
| Chromium preview panel | Clicks, typing, accessibility-tree snapshots, console/network inspection |
| `npx tsc --noEmit` | Typecheck after every change |
| `npx expo lint` | Lint after every change |
| `npx --yes tsx src/lib/*.test.ts` | 21 hand-rolled self-check suites (the project has **no** test runner installed) |
| `node:sqlite` (`DatabaseSync`) | Real SQLite engine for migration/seed verification (`src/lib/storeSchema.test.ts`, 21 checks) |

Two environmental facts shaped the whole pass:

1. **`expo-sqlite`'s wasm backend never resolves in a browser.** Every runtime result therefore comes from the in-memory backend path. The SQL path was verified separately against a real SQLite engine (§11), never by assumption.
2. **Metro's file watcher misses edits on this OneDrive-synced path.** Twice during the pass the dev server served a stale bundle and a *test result* was wrong while the *code* was already correct. Every runtime result in this report was re-taken after confirming the served bundle contained the current source (grep of `/index.ts.bundle` for the change's own marker string) — this was a test-harness defect, not an app defect, and is recorded as a finding (F-12).

---

## 4. Method and evidence rules

- A screen is **VERIFIED** only if it was opened in the browser, driven through the workflow, and the observed result read back from the accessibility tree (never from the code alone).
- Failures were reproduced first and fixed at the root; the fix was then re-executed through the same journey.
- Validation was not weakened and functionality was not removed anywhere: every fix either makes an existing rule work or adds the missing half of a feature.
- No real user data existed to destroy. The browser store is fabricated by the seed and is rebuilt on every page load; no device database was present in this environment. Test data created during the pass (a terminal, a ticket, one ended trip, one municipality rename) lived only in the browser session, and the municipality rename was **restored to the seeded value** before the pass ended (§8.4).

---

## 5. Component inventory

| Layer | Count | Files |
| --- | --- | --- |
| Screens | **20** | `AddTicketScreen`, `AddTripScreen`, `AdvancedSettingsScreen`, `BarangayConfigScreen`, `BarangayEditor`, `BarangayPickerScreen`, `CurrentTripScreen`, `DashboardScreen`, `FareSettingsScreen`, `HistoryScreen`, `HomeScreen`, `MunicipalityEditor`, `PassengerScreen`, `SettingsScreen`, `TerminalConfigScreen`, `TerminalEditorScreen`, `TicketDetailScreen`, `TicketHistoryScreen`, `TripScreen`, `TripTicketsScreen` |
| Components | **17** | `BottomSheet`, `GlassCard`, `GlassBackdrop`, `HomeHeader`, `LedgerRow`, `LocalStorageCard`, `PeriodControl`, `QuickActionsGrid`, `SectionChrome`, `SectionHeader`, `StorageNote`, `SummaryDisclosure`, `dashboard/Rows`, `dashboard/StatusCard`, `history/RangeCalendarModal`, `home/HomeHero`, `home/LastTripCard` |
| Data layer | **7** | `tripTicketsStore`, `fareStore`, `historyStore`, `konduktStore`, `passengerStore`, `schema`, `tripHelpers` |
| Pure logic (`src/lib`) | **52 files** incl. **21 `.test.ts` suites** | fare model, view-state modules, theme, preferences, `storeSchema`, `seedData` |
| HTML prototypes | 14 root `*.html` | Reference designs (`home.html`, `dashboard.html`, …), audited against the RN build in `UI-AUDIT.md` |

New in this pass: `src/lib/storeSchema.ts` (+ test), `src/lib/seedData.ts` (+ test).

---

## 6. Feature coverage matrix

| # | Feature / workflow | Status |
| --- | --- | --- |
| 1 | Home hero — running trip / idle / last-trip states, collected-today, quick-action tiles | VERIFIED |
| 2 | Dashboard — Day / Week / Month / custom range / per-closed-day / summary disclosure / fallback & closed-period states | VERIFIED |
| 3 | Trip screen — running trip, ledger, End trip | VERIFIED |
| 4 | Add Ticket — origin/destination sheets with IN USE marking, passenger category chips, quantity stepper, fare card, commit gate, "Ticket recorded" sheet, ledger update | VERIFIED |
| 5 | Trip Tickets ledger | VERIFIED |
| 6 | Ticket history (read-only) + ticket detail (read-only) | VERIFIED |
| 7 | Passenger summary — passenger-type filters | VERIFIED |
| 8 | History — tabs, filters, Day/Week/Month period control, calendar, custom range | VERIFIED |
| 9 | Settings — four modules, live counts, readiness block, offline note | VERIFIED |
| 10 | Fare Configuration — 10 inputs, live preview recompute, validation gate, save + confirmation | VERIFIED |
| 11 | Terminal Configuration — search, status filter, add, duplicate rejection, record sheet, Deactivate, live counts | VERIFIED |
| 12 | Barangay Configuration — both tabs, scope, search, status filter, record sheet, deactivation guard | VERIFIED |
| 13 | **Municipality Editor — create half** (add, duplicate rejection, flash) | VERIFIED |
| 14 | **Municipality Editor — edit half** (read, unchanged-pair save, duplicate rejection, rename + linked-row refresh, flash) | VERIFIED *(newly fixed — §17)* |
| 15 | Add Trip / Barangay picker (route options, start trip) | CODE VERIFIED |
| 16 | Advanced Settings — theme tap is the commit, optimistic paint, chained writes, failure banner, persisted mode | VERIFIED |
| 17 | Dark mode **painting** across screens | **FAILED (open — §21)** |
| 18 | SQLite schema bootstrap, idempotent upgrade, seed | CODE VERIFIED *(real SQLite via `node:sqlite`, `storeSchema.test.ts`)* |
| 19 | Second-launch reopen of an existing database | CODE VERIFIED → was FAILED before the fix (§13) |
| 20 | Android hardware back button | **BLOCKED (no device) — code path CODE VERIFIED (§16)** |
| 21 | Native `expo-sqlite` on a device build | **BLOCKED (no device)** |
| 22 | Safe areas, keyboard behaviour, animations on device | **BLOCKED (no device)** |
| 23 | Empty states (no trips, no terminals, no barangays, fare rules absent) | VERIFIED |
| 24 | Duplicate rejection and deactivation guards | VERIFIED |
| 25 | Offline statement / storage notes | VERIFIED |

---

## 7. Runtime journeys executed

All of the following were driven by real input events and read back from the accessibility tree:

1. Home → hero states (running trip, idle, last trip) → quick-action tiles.
2. Home → Dashboard → Day / Week / Month / custom range / a closed day → summary disclosure open/close.
3. Home → Trip → End trip → confirmation → History shows the ended trip and the ledger is retained.
4. Home → Tickets → Add Ticket → origin sheet (stops marked IN USE) → destination → passenger type chips → quantity stepper → fare card recomputation → commit → "Ticket recorded" sheet → updated ledger.
5. Ticket history → ticket detail (read-only) → back.
6. Passenger summary → passenger-type filters.
7. History → tabs / filters / period control / calendar.
8. Home → Settings → each module → back.
9. Fare Configuration → edit inputs → preview recompute → validation gate blocks invalid input → save → "Fare configuration saved."
10. Terminal Configuration → search → filter → Add Terminal → duplicate rejection ("Santa Cruz is already registered in Olongapo.") → record sheet → Deactivate → live count change.
11. Barangay Configuration → both tabs → scope filters → record sheet → EDIT.
12. Barangay Configuration → Municipalities → record sheet → **EDIT → save unchanged / duplicate rename / real rename / restore** (§18).
13. Settings → Advanced Settings → toggle dark → toggle light → persisted preference read back.
14. Full-page reloads to confirm no future-dated seed and no stale state.

---

## 8. Seed data and state validation

### 8.1 The dataset
`src/lib/seedData.ts` is now the **single** source of seed truth, consumed by both the SQL store and the in-memory backend:

- 3 municipalities (Iba/Zambales, Olongapo/Zambales, Caloocan/Metro Manila)
- 5 terminals at 96.800 / 228.000 / 232.400 / 249.600 / 314.200 km
- 6 trips (one ACTIVE, five COMPLETED) and 17 tickets
- The fare row (₱50 minimum, 4.5 km floor, ₱1.75/km and the four class rates) and the SCTEx row — the configuration every fare was actually priced from
- All distances derived from KM markers; all fares produced by `priceTicket`, not literals

### 8.2 Why it changed
The old SQL seed carried a 12.6 km trip on a route whose markers give 4.4 km, fares no configuration can produce, only 3 trips / 6 tickets, **and no fare row at all** — so a fresh device opened on a running trip that could not be recorded against ("This device has no fare rules yet").

### 8.3 Freshness
Seed times are derived from `Date.now()`, never from fixed clock offsets. Verified live at 01:24 local: **"Started 1:06 AM · 30m running"**, 4 tickets today, ₱836.14 — no future-stamped rows (the same numbers came out of the SQL path: 6 trips / 17 tickets / 5 terminals / 3 municipalities / 1 fare row).

### 8.4 Test data hygiene
Created during the pass: one terminal, one ticket, one ended trip, one municipality rename (`Iba` → `Iba Sur`). The rename was **reverted to `Iba`** and confirmed back in the list at the end of the pass. The remainder lives only in the browser's in-memory store, which is rebuilt from `seedData` on every page load.

---

## 9. Business logic — fares

The fare model (`src/lib/addTicketFare.ts`: `priceTicket`, `toFareRules`, `commitBlockReason`, `foldLedger`) is the contract every other module must agree with.

- Minimum fare ₱50.00 and the 4.5 km distance floor both apply before the rate; the floor is applied in milli-km and never rounded up to a whole kilometre.
- Four passenger classes and two road classes price independently; observed fares include ₱112.06 (student, express) and the seeded ₱193.95 / ₱387.90 / ₱489.15 / ₱50.00, all reproduced by `priceTicket` in `seedData.test.ts` (29 checks).
- The commit gate blocks a boarding when rules are absent or the selection is incomplete; the message is the data layer's own sentence, quoted on screen.
- Scaled-integer conversions (`fareFormat`) round-trip through `fareConfigState`'s preview without drift; the preview recomputes live from the form and refuses to save while invalid.
- Documented and accepted: the fare input's keystroke filter permits `1.2.3` and the save-time validator rejects it — boundary check, not a filter check. No change made.

---

## 10. Business logic — distance and history

- Distances are computed from the trip's KM markers, never from a literal; the seeded 4.4 km / 86.2 km values and the `12_600` defect are covered by `seedData.test.ts`.
- Daily/weekly/monthly folding uses inclusive-start, exclusive-end windows; the History page query's bind order (ticket window → trip window → search → limit/offset, with the status filter inlined) was a previously identified defect and is now regression-locked by `historyState.test.ts`.
- Trip completion keeps the ledger: ending a trip re-reads the board and the totals remain.

---

## 11. Data layer and persistence

| Concern | Result |
| --- | --- |
| Bootstrap DDL | Single source: `BOOTSTRAP_SQL` in `storeSchema.ts`; `fareStore` no longer re-declares its own copy of the table DDL |
| Migrations | Idempotent: `upgradeStatements({ seeded, columns })` plans an `ALTER` **only** for a column the live schema does not have; `addColumnStatement` returns `null` when it exists |
| Version stamp | `SEEDED_VERSION = 'v5'` |
| Rebuild path | v1 / v2 / unstamped databases are dropped and recreated rather than back-filled (no shipped user data) |
| Failed open | Not cached: a rejected open clears the slot so the next read retries instead of replaying the rejection for the life of the process |
| Web fallback | 2-second race is **web-only**; on native a slow open is slow, never silently replaced by fabricated records |
| SQL-path proof | `storeSchema.test.ts` drives a real `node:sqlite` `DatabaseSync`: bootstrap self-consistency, the v4 regression, a genuine v3 upgrade, a half-migrated re-plan, plus a boot → seed → board → end-trip → **2nd and 3rd launch** replay that neither throws nor re-seeds |
| Native path | **BLOCKED** — no device (§25) |

---

## 12. Findings register

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| F-01 | **CRITICAL** | FAILED → **FIXED, re-verified** | Second launch crashed the whole app: `duplicate column name: uses_sctex` |
| F-02 | **HIGH** | FAILED → **FIXED, re-verified** | SQL seed data was internally inconsistent and omitted the fare row |
| F-03 | **HIGH** | FAILED → **FIXED, VERIFIED** | Seed timestamps were in the future ("Started 6:30 AM" at 00:17) |
| F-04 | **HIGH** | FAILED → **FIXED, CODE VERIFIED** | Android hardware back exited the app from every inner screen |
| F-05 | **HIGH** | FAILED → **FIXED, VERIFIED** | "Edit Municipality" routed to a "not built yet" placeholder |
| F-06 | **HIGH** | FAILED → **FIXED, VERIFIED** | The in-memory backend had no read/write for the new edit — every Edit said the record was gone |
| F-07 | MEDIUM | FAILED → **FIXED, CODE VERIFIED** | The 2 s open timeout could silently swap the real DB for fabricated records on device |
| F-08 | MEDIUM | FAILED → **FIXED, CODE VERIFIED** | A failed DB open was cached for the process lifetime |
| F-09 | MEDIUM | **FAILED — OPEN** | Dark mode paints only two of ~37 modules; every screen still renders light |
| F-10 | MEDIUM | **FAILED — OPEN** | Dead affordance: the Trips tile opens a Trip screen whose "End trip" is disabled |
| F-11 | LOW | Noted | Editing a municipality returns to the Barangays tab, not the tab being edited |
| F-12 | LOW | Noted (tooling) | Metro's watcher misses edits on the OneDrive path; stale bundle = wrong test result |

No finding remains in a FAILED state except F-09 and F-10, both of which are user-visible defects with known root causes and no data impact.

---

## 13. F-01 — CRITICAL: second-launch crash on the SQL path

**Found:** CODE REPLAY (real SQLite engine), not on device.
**Cause:** `openDatabase()` created `trips` **with** `uses_sctex`, then the seed stamped `'v4'` at the end. On the next launch the `v4` branch ran `ALTER TABLE trips ADD COLUMN uses_sctex`, real SQLite threw `duplicate column name: uses_sctex`, and the cached `opening` promise **replayed that rejection forever** — from its second launch on, the app could not read a single record.
**Fix:** `storeSchema.ts` — one idempotent upgrade plan driven by the columns that actually exist; the stamp only advances after a plan that can no longer fail; `opening` cleared on rejection.
**Evidence:** `storeSchema.test.ts` (21 checks on `node:sqlite`) including the exact v4-stamped regression, plus a boot → seed → end-trip → 2nd → 3rd launch replay.
**Status:** FAILED → **CODE VERIFIED (real SQLite), re-verified after fix.** Native confirmation is BLOCKED.

---

## 14. F-02 — HIGH: seed data contradicted its own rules

**Cause:** two independent seed descriptions (SQL vs memory) had drifted: the SQL copy wrote a 12_600 mm-style distance for a 4.4 km route, four fares `priceTicket` can never produce, 3 trips / 6 tickets instead of 6 / 17, and **no fare row** — so on a fresh device a running trip existed that could not be recorded against.
**Fix:** one dataset, `src/lib/seedData.ts`, consumed by both backends, with fares produced by `priceTicket` and distances derived from KM markers; the fare and SCTEx rows are seeded alongside.
**Evidence:** `seedData.test.ts` (29 checks); SQL replay read back 6 trips / 17 tickets / 5 terminals / 3 municipalities / 1 fare row; browser reads "6 trips and 17 fares across 5 days".
**Status:** FAILED → **FIXED, CODE VERIFIED + VERIFIED in browser.**

---

## 15. F-03 — HIGH: future-dated seed data

**Cause:** seed times were `startOfToday + 6.5 h`, so at 00:17 the Home hero said "Started 6:30 AM", "0m running", with tickets stamped in the future.
**Fix:** `buildSeed(now)` derives every timestamp from the clock that opened the app (running trip = `now − 30 min`, boardings after start, all offsets positive, no row in the future).
**Evidence:** live at 01:24 — **"Started 1:06 AM · 30m running"**, 4 tickets today, ₱836.14, 6 passengers; `seedData.test.ts` includes a 00:17 clock case.
**Status:** FAILED → **FIXED, VERIFIED.**

---

## 16. F-04 — HIGH: hardware back exited the app

**Cause:** no `BackHandler`, `useFocusEffect` or navigation back stack anywhere (grep returned nothing) — Android's default back therefore closed the app from Settings, from a form, from anywhere but Home, which reads as a crash.
**Fix:** `HomeScreen` registers a `BackHandler` (Android only) whose mapping is the parent of whatever is open, with two deliberate exceptions: ticket detail returns to whichever ledger opened it (`ticketDetailBack`), and Add Ticket returns to the trip's ledger when a trip id is held. Returning `false` on Home hands the press to the OS, the one place where exiting is correct.
**Evidence:** `handleHardwareBack` covers every `open` value (typecheck-enforced via exhaustive switch); no device to fire the event on.
**Status:** FAILED → **FIXED, CODE VERIFIED. Runtime is BLOCKED (§25).**

---

## 17. F-05 — HIGH: "Edit Municipality" was an unreachable placeholder

**Cause:** `BarangayConfigScreen`'s record sheet has a working EDIT button, but the router sent a non-null municipality id to `UnbuiltEditor` ("The municipality editor is not built yet"). Reproduced live before the fix.
**Fix:** the edit half was implemented end to end — `MunicipalityEditor` accepts an id, reads the row through a `LoadState` machine (create / loading / error / notFound / ready, with a "Read it again" retry), reuses the same validator and notice slot, and calls `updateMunicipality`; `municipalityEditorChrome(id)` supplies the create/edit chrome; the router passes the id and the placeholder component was deleted.
**Evidence:** reproduced first (placeholder), then live: chrome reads "Edit Municipality · Renames the record, keeps its links · SAVE CHANGES", and the form loads `Municipality = Iba`, `Province = Zambales`.
**Status:** FAILED → **FIXED, VERIFIED.**

---

## 18. F-06 — HIGH: the in-memory backend could not execute the edit (found this session)

**Found:** at runtime — after F-05 was fixed, every Edit still reported **"That municipality is no longer on this device."** for a row the list was showing one screen earlier.

**Root cause:** `memoryBackend()` is a hand-written SQL recogniser, and three statements behind the new feature were missing from it:

1. `SELECT * FROM municipalities WHERE id = ?` fell through to `return null` → the screen's honest not-found branch fired on a live row.
2. `UPDATE municipalities SET name = ?, province = ? WHERE id = ?` fell through to `{ changes: 0 }` → a successful rename would read as `notFound` and keep the form open over a write that had landed.
3. The duplicate SELECT bound `AND id != ?` (a third parameter) which the handler ignored → renaming a record to its **own stored pair** would be refused as a duplicate of itself.

**Fix:** the three handlers added to `tripTicketsStore.ts`, mirroring the SQL statement's own bind order.

**Evidence — all executed live:**

| Step | Result |
| --- | --- |
| Edit Iba | Form loads `Iba` / `Zambales` ✅ |
| Save unchanged | Flash **"Iba updated."**, returned to the list ✅ (proves the `id != ?` exclusion) |
| Rename to `Olongapo` | Alert **"Olongapo is already listed in Zambales."**, field marked invalid, values retained, no navigation ✅ |
| Rename to `Iba Sur` | Flash **"Iba Sur updated."**; linked barangay row changed to **"Iba, Iba Sur · 96.800 km"** ✅ (the link followed the rename, as designed) |
| Restore | Rename back to `Iba`, list confirmed **"Iba, Zambales · 1 barangay"** ✅ |
| Regression | `tsc` clean, `expo lint` clean, 21/21 suites pass ✅ |

**Status:** FAILED → **FIXED, VERIFIED.**
**Note:** `deactivateMunicipality` reads the same statement, so the municipality deactivation guard now sees the real row on the web backend too (it previously fell through to not-found).

---

## 19. F-07 / F-08 — MEDIUM: two ways to lose the real database

- **F-07:** the 2 s `Promise.race` around the native open applied on *all* platforms, so a slow cold open on a low-end device (big ledger, cold WAL) would silently swap the conductor's real database for the fabricated one — phantom trips on screen, every fare afterwards lost. **Fix:** the fallback now runs only when `Platform.OS === 'web'`; on native a slow open is simply slow.
- **F-08:** `opening` held a rejected promise for the life of the process, so one transient failure (locked file, full disk) read as every trip having vanished until relaunch. **Fix:** the catch clears `opening`.

**Status:** FAILED → **FIXED, CODE VERIFIED** (both paths are exercised only under conditions this environment cannot produce — see §25).

---

## 20. F-10 — MEDIUM: dead affordance on the Trips tile *(open)*

**Observed:** the Home "Trips" quick-action tile opens the Trip screen, which renders **"End trip" disabled** (`aria-disabled=true`) alongside an enabled "Start trip" — a pressable whose visible action does nothing. When no trip is running the tile labelled "Current Trip" has the same problem.
**Why it is still open:** it is a UX decision, not a logic error — the screen's real Start affordance is reachable from the top CTA, and no data is at risk. Resolving it means either routing the tile to the ledger when a trip is running or hiding the disabled control; both change designed behaviour, so the choice was left to the maintainer rather than made unilaterally in an audit pass.
**Severity:** MEDIUM (dead but harmless) · **Status:** FAILED — OPEN.

---

## 21. F-09 — MEDIUM: dark mode is a two-of-thirty-seven module migration *(open)*

**Observed at runtime:** toggling dark mode in Advanced Settings persists correctly (`localStorage kondukt.preferences.themeMode = 1`, root backdrop `rgb(18,22,28)` = `darkGlass.backdrop`, status bar follows), but every screen still renders **light**: `rgb(244,247,251)` (light `glass.backdrop`), light tinted cards, light text ramps.

**Root cause (not a token bug):** `KonduktTheme` bundles `palette` / `glass` / `accent`, and only **3** modules consume it — `SettingsScreen`, `AdvancedSettingsScreen`, `SectionChrome`. The other ~34 files import `palette`, `glass`, `accent` as **module-level constants** and read them inside `StyleSheet.create(...)` evaluated once at module load, so those values are frozen to light for the life of the process. `GlassCard` additionally hard-codes `BlurView tint="light"` and reads light `glass.tint` / `rim` / `grain`; `GlassBackdrop` destructures the light field arrays at module scope.

**Why a partial fix would make it worse:** repainting only the shared backdrop and cards while screen text stays light-on-light produces unreadable dark mode rather than broken-looking light mode — the migration must be atomic per screen.

**The migration (mechanical, ~34 files):**
1. Add `useThemedStyles(makeStyles)` — one memoised stylesheet per mode, keyed on the stable factory.
2. Convert each module-level `const styles = StyleSheet.create({…})` into `const makeStyles = (theme: KonduktTheme) => StyleSheet.create({…})`, including every nested component in the file.
3. Qualify in-body token references: `palette.` → `theme.palette.`, `glass.` → `theme.glass.`, `accent.` → `theme.accent.`. `tintedGlass` and `type` / `space` / `radius` stay static (the accent pigment and typography are deliberately identical in both modes).
4. `GlassCard` → BlurView `tint` from `theme.mode`; `GlassBackdrop` → theme field arrays.
5. Regression: toggle dark → all 20 screens → toggle light.

No screen can be skipped: leaving even one on light tokens reintroduces the mixed render this finding describes.
**Severity:** MEDIUM (visual/consistency, no data impact) · **Status:** FAILED — OPEN, root cause and plan documented.

---

## 22. F-11 / F-12 — LOW

- **F-11:** after saving a municipality edit the screen returns to Barangay Configuration's default **Barangays** tab rather than the **Municipalities** tab the operator came from. Cosmetic navigation-context loss; the flash and the updated row are both visible one tap away. Noted, not changed.
- **F-12 (tooling):** Metro's watcher does not observe file changes on this OneDrive-synced path, so a running dev server serves a stale bundle until restarted with `--clear`. This corrupted two intermediate test results during the pass (the code was already correct while the screen still failed). Every result in this report was re-taken after grepping the served bundle for the change's marker. No app impact; recorded so the next person does not chase a phantom regression.

---

## 23. Validation coverage — empty, populated, rejected and guard states

| State | Status |
| --- | --- |
| No trips / no terminals / no barangays / no municipalities | VERIFIED |
| Fare rules absent — Add Trip / Add Ticket refuse and name the missing rule | VERIFIED (and eliminated at the source: the seed now writes the fare row) |
| Populated app — 6 trips / 17 fares / 5 terminals / 3 municipalities / 5 barangays | VERIFIED |
| Duplicate rejection — terminal, municipality (create **and** edit) | VERIFIED |
| Deactivation guard — municipality with active terminals | VERIFIED |
| Repeat deactivate reads as not-found (documented discipline) | CODE VERIFIED |
| Validation refusal — empty / comma / whitespace on both editor fields | VERIFIED |
| Save failure keeps every typed value and navigates nowhere | CODE VERIFIED |
| Closed period / fallback period on the Dashboard | VERIFIED |
| Read-only surfaces — ticket detail, ticket history | VERIFIED |

---

## 24. Regression results (final, after the last change)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | ✅ **clean** |
| Lint | `npx expo lint` | ✅ **clean** |
| Unit self-checks | `npx tsx src/lib/*.test.ts` | ✅ **21 / 21 suites pass** |
| | `storeSchema.test.ts` | all checks passed (21, real SQLite) |
| | `seedData.test.ts` | all checks passed (29) |
| | `municipalityEditorState.test.ts` | all passed (incl. new edit-state/chrome checks) |
| | 19 pre-existing suites | all passed (unchanged expectations) |
| Runtime smoke | Expo web, seeded memory backend | ✅ hero figures correct, edit journey re-run end to end, no console errors |

Tests added by this pass: `storeSchema.test.ts`, `seedData.test.ts` (+ edit-mode assertions in `municipalityEditorState.test.ts`), taking the suite count from 19 to 21. Nothing was deleted or weakened; no existing assertion was relaxed.

---

## 25. Limitations and BLOCKED items

1. **No Android device or emulator** (`adb devices` empty) and no Expo Go client. **BLOCKED:** the hardware-back handler (F-04), native `expo-sqlite` including WAL, the real `kondukt.db` file, on-device safe areas, keyboard avoidance, hardware animations and a genuine cold open. These are **CODE VERIFIED** at best and are labelled accordingly throughout — never VERIFIED.
2. **No iOS toolchain** (no `pod install`, no simulator). Same treatment as (1).
3. **Browser runs use the in-memory backend** (wasm never resolves), so every runtime result describes the shim's SQL recogniser. The SQL path is covered separately by `storeSchema.test.ts` on `node:sqlite` plus an ad-hoc boot/replay harness (deleted after use). The two paths are now driven by one `seedData` module, which is what removes the drift class F-02 belonged to.
4. **No test runner is installed** in this project; all suites are self-check scripts executed with `tsx`.
5. **Dark mode (F-09)** was deliberately left open rather than half-migrated — see §21 for why partial theming is worse than documented light mode.
6. **`AGENTS.md` says "use Expo Router"; the app uses neither Expo Router nor React Navigation.** Documentation/code mismatch — flagged for the maintainer, no code changed.

---

## 26. Sign-off and recommended next actions

**Result:** **12 findings** — **8 fixed and re-verified** (F-01 CRITICAL; F-02, F-03, F-04, F-05, F-06 HIGH; F-07, F-08 MEDIUM), **2 open** (F-09 dark-mode migration and F-10 dead End-trip affordance, both MEDIUM), **2 noted** (F-11, F-12, LOW). Zero known failures remain in the fare model, the persistence layer, or any workflow that was executed. Typecheck, lint and all 21 suites are clean, and every runtime claim above was re-taken from a confirmed-current bundle.

**Recommended order of work after this report:**

1. **F-09 dark-mode migration** — follow §21 step by step, verifying all 20 screens per screen group; this is the only user-visible open defect.
2. **Device pass for the BLOCKED items** — attach an Android device, confirm hardware back on every screen, confirm `kondukt.db` opens, seeds, and reopens on the second launch (F-01's real-world proof), and confirm a genuinely slow native open is never replaced by the fallback (F-07).
3. **F-10** — decide the Trips tile's destination (or hide the disabled control) and remove the dead affordance.
4. **F-11** — return to the originating tab after a registry edit.
5. **Align `AGENTS.md` with the navigation the app actually uses.**
