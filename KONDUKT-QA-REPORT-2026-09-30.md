# Kondukt — End-to-End QA & Data-Integrity Report

**Report date:** 30 September 2026
**Environment:** Expo web dev server `http://127.0.0.1:8090/`, Chromium preview panel
**Database under test:** **real `expo-sqlite` (`kondukt.db`) via OPFS/wasm** — verified by repeated full-reload persistence probes (data survived every reload; the 15 s in-memory-fallback race never fired this session)
**App data:** dev build (`DEMO_DATA_ENABLED`), seeded demo dataset, **regenerated at end of session from the canonical builder**

**Status labels:** **VERIFIED** = executed at runtime and observed correct · **CODE VERIFIED** = confirmed by code/automated checks only · **BLOCKED** = not testable in this environment (reason stated).
**Severity:** CRITICAL · HIGH · MEDIUM · LOW.

---

## 1. Final status summary

| Metric | Result |
| --- | --- |
| Screens tested / total | **21 / 21** opened, exercised, back-navigated |
| Primary nav paths tested | **6** tabs (Dashboard, Tickets/Trip, Current Trip, Passenger, History, Settings) + all secondary Settings destinations + drill-downs (trip → trip tickets → trip ledger → ticket detail, history → read-only trip → detail) |
| SQLite tables tested / total | **7 / 7** (trips, passenger_transactions, municipalities, terminals, fare_configuration, sctex_fare_configuration, meta) |
| CRUD operations exercised | trips C/R/U(end) · tickets C/R · terminals C/R/U(deactivate) · municipalities C/R/U(deactivate, guard) · fare config R/U · meta R (seed gate) — no DELETE exists anywhere in the data layer by design |
| Calculations verified | priceTicket (both roads × 4 fare types), distance floors, fare floor, quantity clamp (1–20), trip totals, dashboard/history/passenger aggregates, fare-settings preview, add-trip estimate |
| Persistence tests | **5** full-reload probes (trip end state, created trip+ticket, fare config, terminal/municipality edits, theme, final pristine reseed) — all survived |
| Automated tests | **17 / 17 suites pass, 0 failures** (`src/lib/*.test.ts` + `src/data/*.test.ts`) |
| Typecheck `npx tsc --noEmit` | **PASS** (exit 0) |
| Lint `npx expo lint` | **PASS** — 0 errors, 3 pre-existing warnings (not from this pass) |
| Production build `npx expo export --platform web` | **PASS** (exit 0, bundles + wasm emitted) |
| Critical bugs remaining | **0** |
| High-priority bugs remaining | **0** (4 found → all fixed and re-verified) |
| Medium remaining | **1** (F-5, terminal edit entry) |
| Low remaining | **4** (F-6…F-9) |

**The app is not claimed to be fully validated on native Android/iOS** — see §8 (environment limits).

---

## 2. Bugs found and fixed this pass

### F-1 · HIGH · `uses_sctex` was never written — every SCTEX trip priced as ordinary
- **Screen/component:** Add Trip → `startTrip()` (`src/data/tripTicketsStore.ts`); affects Add Ticket, Current Trip.
- **Repro:** Start a trip with road = SCTEX → Add Ticket → road shown/read as ordinary, tickets priced at ₱1.75/km with no express rate; `trips.uses_sctex` = 0 in SQLite.
- **Expected:** road setting stored on the trip row; every boarding prices off it (the store's own doc comment promised this).
- **Actual:** `INSERT INTO trips` omitted the `uses_sctex` column → DEFAULT 0 always.
- **Root cause:** column added in schema v5, INSERT never updated; UI copy even admitted "the store does not keep yet".
- **Fix:** added `uses_sctex` column + bound param to the INSERT; same field added to the in-memory backend's INSERT handler and seed rows; corrected the Add-trip copy.
- **Verification:** VERIFIED — trip started as SCTEX persisted `uses_sctex=1` across reload; Add Ticket priced at express ₱2.25/km and Current Trip showed the SCTEX flag.

### F-2 · HIGH · Double-press on "Record ticket" inserted the ticket twice
- **Screen/component:** Add Ticket (`src/screens/AddTicketScreen.tsx`).
- **Repro:** two same-tick presses of Record → tickets #7 **and** #8 created (₱50 fare recorded twice, ₱100 ledger).
- **Expected:** one row per press.
- **Actual:** duplicate financial records (no DB-level dedupe exists; `canRecord` read React state `recording`, which only flips on the *next* render).
- **Root cause:** state-based guard cannot defend the same event tick.
- **Fix:** synchronous `useRef` guard set before the write, cleared on settle (both `.then` and `.catch`).
- **Verification:** VERIFIED — identical double-press now creates exactly one ticket (ledger ₱150 after one insert).

### F-3 · HIGH · Toll-road adjustment disagreed between screens (user-directed resolution)
- **Screens:** Add Trip estimate said billable = route **+0.5 km** on SCTEX (131.7 km), Add Ticket billed route only (135.6 km) for the same road; `priceTicket`'s doc said "never folded in", `fareStore`'s doc said "the adjustment feeds `priceTicket`", and both design prototypes apply +0.5 — four authorities, two behaviours.
- **Resolution (per user instruction "remove the sctex adjustments"):** the toll-road adjustment is **removed from all fare math** — `priceTicket` (billable = distance floor only), `measureTrip`/`estimateNote` (no `adjMilli`), `FareRules.sctexAdjustmentMilli` and `toFareRules`'s sctex parameter deleted, Fare Settings preview and the Add-ticket rules sheet no longer reference it, seed value set to `0`. **No schema change:** `sctex_fare_configuration` table/column and `SEED_SCTEX` row insert remain (column is NOT NULL; nothing reads it).
- **Copy/docs updated:** rules-sheet steps, add-trip road note, priceTicket/addTripState/fareStore doc comments, seed header.
- **Verification:** VERIFIED — Add Trip shows Route = Billable (131.2 = 131.2, ₱2.25/km); Add Ticket shows Distance 86.2 = Billable 86.2 → **₱193.95** (86.2 × 2.25, exact); fare-settings preview ₱489.15 / ₱282.62 unchanged; suites green.

### F-4 · HIGH · Three drifting seed implementations (data-integrity)
- **Found:** (1) inline SQL seed in `seedIfEmpty` with hardcoded fares/distances, (2) `memorySeed()` third copy, (3) `src/lib/seedData.ts buildSeed()` — the documented canonical builder that `seedData.test.ts` actually validates but **neither runtime reader consumed**. Visible damage: trip #5 stored **12.6 km** where its terminals' markers differ by **4.4 km**; seeded fares (₱96.00 on an 86.2 km run) not reproducible from any configuration; `uses_sctex` defaults contradicting the express spec; trip numbers/dates hand-pinned.
- **Fix:** both runtime seeds now consume `buildSeed()` (explicit dense ids for municipalities → terminals → trips → tickets); the hardcoded trips/tickets/terminals/municipalities INSERTs and `memorySeed()` literals are deleted. No version bump needed (seed content ≠ schema; fresh demo DBs pick up the canonical seed, existing dev DBs self-consistent).
- **Verification:** VERIFIED — full OPFS wipe → fresh boot seeded 6 trips / 17 fares / 5 days; every distance equals its marker difference (4.4 / 17.2 / 21.6 / 86.2 / 131.2 / 217.4 km); every fare equals `priceTicket`'s output; Home "COLLECTED TODAY ₱1,136.14" = 2×₱193.95 + ₱112.06×3 + ₱300.00 exactly; survives reload.

### F-5 · MEDIUM · Terminal **edit** has no entry from Terminal Configuration
- Terminal Configuration's record sheet offers only DEACTIVATE ("the sheet carries no Edit until the editor…" — the code's own comment); `onOpenEditor` is only ever called with `null` (create). Editing an existing terminal's KM is only reachable **from Barangay Configuration → record → EDIT** (verified working there: 150 → 155 KM persisted across reload).
- Not changed: exposing the entry is a product decision; the editor itself and its 97-check suite work. **Status: open, documented.**

### F-6 · LOW · React dev-only warnings
- `Each child in a list should have a unique "key" prop … child from RouteCard` (reproduced once; nested `children` array through `GlassCard`'s fragment) and `Unexpected text node: <spaces>` ×4 during earlier navigation (whitespace child under a View). No visual or functional impact; not reproduced on final loads after this pass's edits. Pre-existing, left for backlog.

### F-7 · LOW · "Check for Updates" appears inert in this build
- Click produces no visible change. Intended: dev build hits expo-updates' `ERR_UPDATES_DISABLED` → status `disabled` → "Updates aren't checked in this build." (copy already displayed from the launch auto-check). Release behaviour is COVERED by `updateState.test.ts`, but live checking is **BLOCKED** in this environment.
- Minor sub-note: the secondary line still reads "No update check yet on this install" after a manual attempt.

### F-8 · LOW · Duration wording on Passenger screen
- Long runs print "420 minutes on the road" (7 h) — minutes-only phrasing. Cosmetic; other screens format h/m.

### F-9 · LOW · Sheet copy inconsistency (Barangay record sheet)
- Barangay record sheet says "Nothing is written from this sheet" yet shows a DEACTIVATE action that writes; Terminal Configuration's equivalent sheet correctly says "Only the status is written from this sheet."

**Housekeeping:** session tooling regenerated `assets/favicon.png` / `assets/icon.png` as tiny placeholders and dropped an untracked `assets/favicon.ico` — originals restored via `git checkout`, artifact removed. No test records, fake config, or debug UI remain in the app or the database (see §7).

---

## 3. Screen coverage (21 / 21)

| # | Screen | Nav in/out | UI + forms | SQLite read | SQLite write | Persist (reload) | Calc | Issues |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Home (`HomeScreen`) | VERIFIED | VERIFIED | VERIFIED | — | VERIFIED | VERIFIED (live totals) | — |
| 2 | Dashboard | VERIFIED | VERIFIED (day/week/month/prev/next/custom range/return-to-today) | VERIFIED | — | — | VERIFIED (period sums exact) | — |
| 3 | Trip management | VERIFIED | VERIFIED | VERIFIED | — | — | — | — |
| 4 | Add Trip | VERIFIED | VERIFIED (pickers, swap/clear, same-terminal refusal, leave-sheet) | VERIFIED | VERIFIED (`startTrip`) | VERIFIED (trip #7) | VERIFIED (distance/rate/billable) | F-1 (fixed) |
| 5 | Current Trip (live) | VERIFIED | VERIFIED (end-trip confirm + cancel) | VERIFIED | VERIFIED (`endActiveTrip`) | VERIFIED | VERIFIED (elapsed, SCTEX flag) | — |
| 6 | Current Trip (empty) | VERIFIED | VERIFIED | VERIFIED | — | — | — | — |
| 7 | Add Ticket | VERIFIED | VERIFIED (route pickers, 4 fare types, qty 1–20, double-press, rules sheet, recorded sheet, ledger) | VERIFIED | VERIFIED (`recordTicketRow`) | VERIFIED | VERIFIED (both roads × all types vs hand math) | F-2 (fixed), F-3 (fixed) |
| 8 | Add Ticket (no fare rules) | CODE VERIFIED (branch; seed always provides rules in dev) | CODE VERIFIED | — | — | — | — | BLOCKED to force |
| 9 | Trip Tickets (writable + read-only) | VERIFIED | VERIFIED (closed-trip banner, VIEW ALL) | VERIFIED | — | — | VERIFIED (collected/avg) | — |
| 10 | Ticket History (trip-scoped) | VERIFIED | VERIFIED | VERIFIED | — | — | VERIFIED (Σ = trip total) | — |
| 11 | Ticket Detail | VERIFIED | VERIFIED (read-only copy, why-this-amount) | VERIFIED | — | — | VERIFIED (fare × qty) | — |
| 12 | Passenger | VERIFIED | VERIFIED (filters, switch-trip, cross-trip scoping) | VERIFIED | — | — | VERIFIED (breakdown Σ = trip) | F-8 wording |
| 13 | History | VERIFIED | VERIFIED (3 tabs, 3 ranges, search, status filter, empty state, storage note) | VERIFIED | — | VERIFIED | VERIFIED (earnings-by-day Σ) | — |
| 14 | Settings | VERIFIED | VERIFIED | — | — | — | — | F-7 |
| 15 | Fare Configuration | VERIFIED | VERIFIED (dirty state, validation, save, disabled-when-clean) | VERIFIED | VERIFIED | VERIFIED (1.80 survived reload, restored 1.75) | VERIFIED (preview = `priceTicket`) | — |
| 16 | Terminal Configuration | VERIFIED | VERIFIED (create, validation, duplicate refusal, detail sheet, status filter) | VERIFIED | VERIFIED | VERIFIED | — | F-5 (no edit entry) |
| 17 | Barangay Configuration | VERIFIED | VERIFIED (both tabs, municipality filter, status filter, create/edit/deactivate) | VERIFIED | VERIFIED | VERIFIED (155 KM + rename + INACTIVE after reload) | — | F-9 |
| 18 | Barangay Editor (terminal editor) | VERIFIED (via Barangay config) | VERIFIED (validation, dupe, save) | VERIFIED | VERIFIED | VERIFIED | — | F-5 |
| 19 | Municipality Editor | VERIFIED | VERIFIED (empty-save, duplicate "already listed in Zambales", create, rename, deactivate) | VERIFIED | VERIFIED | VERIFIED | — | — |
| 20 | Barangay Picker (ticket route sheets) | VERIFIED | VERIFIED (search, km distances, "already the boarding point" guard, inactive/missing warnings) | VERIFIED | — | — | VERIFIED (live marker diffs) | — |
| 21 | Advanced Settings | VERIFIED | VERIFIED (light/dark radios) | — (AsyncStorage) | VERIFIED | VERIFIED (dark survived reload; restored light) | — | F-7 area |
| — | App Updates card | VERIFIED (renders, presses) | VERIFIED | — | — | — | — | F-7 BLOCKED live check |

Empty states VERIFIED: dashboard past-period + no-records, history filtered-empty ("No trips match the selected filters"), current-trip none, add-ticket ledger empty, trip-ticket closed, passenger (seed always has data in dev).
Error states CODE VERIFIED only: read-failure/retry branches require a fault injection this environment can't trigger cleanly (CODE VERIFIED via `dashboardState`/store error paths + tests).

---

## 4. Database coverage (7 / 7)

| Table | Create | Read | Update | Delete | Relationships | Persist | Integrity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `trips` | VERIFIED (`startTrip`, seed) | VERIFIED (board/history/ticket scopes) | VERIFIED (`endActiveTrip`, guarded `AND status='ACTIVE'`) | none by design | PK → tickets.trip_id | VERIFIED | trip_number unique (seed ids dense; MAX+1 generation in-transaction) |
| `passenger_transactions` | VERIFIED (`recordTicketRow`, seed) | VERIFIED (fold, ledger, history windowed, passenger scope) | none by design (append-only) | none by design | FK → trips.id | VERIFIED | total = fare × qty on every row checked; Σ rows = displayed totals everywhere |
| `municipalities` | VERIFIED (seed + UI) | VERIFIED | VERIFIED (rename) | deactivate only | → terminals | VERIFIED | deactivate **refused while active terminals exist** (guard VERIFIED) |
| `terminals` | VERIFIED (seed + UI) | VERIFIED | VERIFIED (deactivate) | deactivate only | → municipalities | VERIFIED | duplicate name-in-municipality refused; marker ≥ 0 enforced |
| `fare_configuration` | VERIFIED (seed) | VERIFIED (4 screens) | VERIFIED (10-column transactional save, preserves `created_at`) | n/a (singleton id=1) | — | VERIFIED | save never writes the 3 dropped columns |
| `sctex_fare_configuration` | VERIFIED (seed row) | CODE VERIFIED | not written by app (by design) | — | — | — | **no longer read by fare math** (F-3) |
| `meta` | VERIFIED (seed stamp `v5`) | VERIFIED (seed gate every open) | — | — | — | VERIFIED | version stamp = `SEEDED_VERSION` literal |

No `DELETE` statements exist in the data layer; FK enforcement is not enabled (`PRAGMA foreign_keys` unset) — noted as pre-existing architecture, all FK targets verified valid (every ticket's trip exists; every seeded terminal's municipality exists or is null by design for Subic).

---

## 5. Data-integrity verification (UI ↔ SQLite ↔ calculations)

All checked against the **final** pristine dataset (post-reseed):

| Check | Expected | Displayed | Result |
| --- | --- | --- | --- |
| Home collected today | 2×193.95 + 112.06 + 2×112.06 + (3+1+2)×50 = **₱1,136.14** | ₱1,136.14 | ✓ |
| Tickets/passengers today | 4+3 = 7 tickets, 6+6 = 12 pax | 7 / 12 | ✓ |
| Storage note | 6 trips, 17 fares, 5 days | 6 / 17 / 5 | ✓ |
| Trip #5 distance | \|232.4 − 228.0\| = **4.4 km** | 4.400 km (fixed: stored 12.6 before F-4) | ✓ |
| Trip #2 express fare (regular) | 217.4 × 2.25 = **₱489.15** | ₱489.15 | ✓ |
| Add-ticket express leg | 86.2 × 2.25 = **₱193.95**, billable = distance (F-3) | ₱193.95 / 86.2 | ✓ |
| Short hop | 4.4 → floor 4.5 → 7.88 → **₱50** | ₱50.00 | ✓ |
| Discounted express | 217.4 × 1.30 = **₱282.62** | ₱282.62 | ✓ |
| Qty clamp | max 20 → 20 × 195.08 = ₱3,901.60 | stops at 20, + disabled | ✓ |
| History earnings-by-day | days Σ = period total; rows Σ = 17 tickets | ✓ (pre- and post-reseed passes) | ✓ |
| Passenger breakdown | per-trip types Σ = trip passengers | ✓ (6-trip switcher spot-checks) | ✓ |
| Config → ticket | rate 1.80 saved → live ticket **₱148.32** (82.4 × 1.8) | ₱148.32 | ✓ then restored to 1.75 |
| Fare config round-trip | save 1.80 → reload → 1.80 → restore 1.75 | ✓ | ✓ |

**Pre-fix mismatches (all resolved):** 12.6 km vs 4.4 km marker drift; seeded fares unpriced-by-config; `uses_sctex` always 0; Add Trip 131.7 vs Add Ticket 135.6 billable; rules-sheet copy claiming "nothing is added" while trip card added 0.5.

---

## 6. Automated tests, typecheck, lint, build

- **17 / 17 suites PASS** (`npx -y tsx src/lib/*.test.ts src/data/*.test.ts`) — incl. `storeSchema.test.ts` (real `node:sqlite` engine), **`seedIfEmpty.test.ts` (real seed path against `node:sqlite`: every stored row equals `buildSeed(now)`, distances = marker diffs, fares re-derive through `priceTicket`, release path stamps without records)**, `seedData.test.ts` (29 checks, canonical builder), `addTripState.test.ts` (updated for F-3: SCTEX bills same distance, express branch note), `fareFormat`, `historyState`, `passengerState`, `tripTicketsState`, `ticketHistoryState`, `dashboardState`, `terminalEditorState`, `municipalityEditorState`, `barangayConfigState`, `barangayPickerState`, `terminalConfigState`, `currentTripState`, `updateState`.
- **`npx tsc --noEmit`** → 0 errors after every edit batch (final run included).
- **`npx expo lint`** → 0 errors; 3 pre-existing warnings (`AddTicketScreen.tsx:18` and `HomeScreen.tsx:39` no-unused-expressions, `TripScreen.ts29` unused `RECENT_LABEL`) — untouched, not introduced here.
- **`npx expo export --platform web`** → exit 0 (production web bundle, wasm, fonts).
- `seedData.test.ts` net content identical to HEAD (its original literals are again the correct outputs under the no-adjustment rule).

---

## 7. Cleanup verification

- Browser DB wiped and **re-seeded from the canonical builder** at session end; no trip/ticket/terminal/barangay/municipality test rows remain (QA Terminal, QA Barangay, QA Town, trip #7 and its ticket are gone — verified by the pristine figures in §5).
- Fare configuration restored to seed values (10/10) before the wipe; the wipe re-seeded them regardless.
- Theme restored to Light; status filters left on ALL.
- No debug UI, no test-only code, no mock data paths added; no schema changes; architecture (state-machine navigation, store modules, append-only tickets) preserved.
- Accidental asset regeneration restored (§2 housekeeping).

---

## 8. Environment limitations (explicitly not claimed as tested)

1. **Native Android/iOS build** — no device/emulator here. Native-only behaviour (hardware back button, native SQLite file on-device, blur performance) is **BLOCKED**; only the shared logic + web runtime were exercised.
2. **Release/empty-DB path** (`DEMO_DATA_ENABLED=false`) — **CODE VERIFIED** (seed gate returns before any seed insert; storeSchema tests cover the stamp) but not executed as a release bundle.
3. **In-memory fallback backend** — architecture reviewed and kept in sync with `buildSeed`, but not exercised this session: the real OPFS SQLite backend won the open race every time (itself a positive signal; the fallback exists for cold-start hangs).
4. **Update check** — dev build refuses (`ERR_UPDATES_DISABLED`); release behaviour covered by tests only (F-7).
5. **Fault-injection error states** (mid-write failure, corrupt DB) — CODE VERIFIED via store error branches and result types; not forced at runtime.
6. **Fast Refresh hook-order crash** — one dev-only crash observed when an edit inserted a hook mid-session; resolved by full reload, does not occur on clean loads.

---

## 9. Fixes applied (files)

| Fix | Files |
| --- | --- |
| F-1 uses_sctex persisted | `src/data/tripTicketsStore.ts`, `src/screens/AddTripScreen.tsx` |
| F-2 double-press guard | `src/screens/AddTicketScreen.tsx` |
| F-3 adjustment removed everywhere | `src/lib/addTicketFare.ts`, `src/lib/addTripState.ts`, `src/lib/addTripState.test.ts`, `src/lib/seedData.ts`, `src/screens/AddTicketScreen.tsx`, `src/screens/AddTripScreen.tsx`, `src/screens/CurrentTripScreen.tsx`, `src/screens/FareSettingsScreen.tsx`, `src/data/fareStore.ts` (doc) |
| F-4 canonical seed consolidation | `src/data/tripTicketsStore.ts` (SQL seed + memory backend), `src/lib/seedData.ts`, `src/lib/seedData.test.ts` (prose) |

Pre-existing uncommitted design-pass files (`HomeScreen`, `HomeHero`, `QuickActionsGrid`, `StorageNote`, `LastTripCard`, `theme.ts`, `UI-AUDIT.md`) were left untouched by this pass.
