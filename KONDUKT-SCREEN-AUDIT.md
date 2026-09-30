# Kondukt — Screen-by-Screen Design & Function Audit

**Scope:** every screen in `com.kondukt.app` (Jetpack Compose, Android). 20 screens, 25 route constants.
**Source:** `app/src/main/java/com/kondukt/app/ui/**` read directly. `graphify-out/` ignored (stale/noise).
**App shape:** single-user, offline-first. Room (`kondukt.db`, 13 migrations) is the only persistence. No network. Every trip, ticket, terminal, barangay, municipality, and fare rule lives on the device.

---

## 1. Design System (applies to every screen)

Source: `ui/theme/Theme.kt`, `ui/common/*`.

**Palette** — brand orange is the only structural color; everything else is neutral.

| Token | Value | Role |
|---|---|---|
| `KonduktOrange` / `primary` | `#FF5A00` | primary action, active accents, top-bar arrow |
| `KonduktYellow` | `#FFD600` | ACTIVE status pills, `IN PROGRESS` chip |
| `KonduktRed` / `error` | `#D50000` | destructive, END TRIP, error state cards |
| `KonduktCanvas` / dark background | `#121212` | dark background |
| `MatteSurface` / `surface` | `#1E1E1E` | card fill |
| `Ink` / `onSurface` | `#F5F5F5` | primary text |
| `SecondaryText` / `onSurfaceVariant` | `#CACACA` | labels, secondary copy |

Dark scheme collapses `primaryContainer` onto solid `KonduktOrange` with `onPrimaryContainer = Black` — that is why intro cards read as full orange blocks in dark and pale peach in light. Light scheme keeps orange only on `primary`.

**Type** — two families, strict split:
- `Poppins` — brand, headings, titles, body, labels.
- `JetBrainsMono` — every *operational* value: money, KM, timestamps, counts, status codes, dialog bodies.
- `labelMedium`/`labelSmall` are globally remapped to JetBrainsMono in `KonduktTypography`, so small-caps labels are mono without per-call-site config.

**Shape** — one ramp, no exceptions: `10 / 14 / 18 / 24 / 28 dp` (`extraSmall`…`extraLarge`). Intro and status cards use `extraLarge` (28 dp); list rows use `large` (24 dp).

**Elevation** — always `0.dp`. Depth comes from fill color and a 1 dp border, not shadow. The single exception is `KonduktGlassCard`, which animates shadow 3→4→1 dp on press with a 0.985 scale.

**Layout invariant** — every scrollable screen is a `LazyColumn` with `.fillMaxWidth().widthIn(max = 600.dp).align(Alignment.TopCenter)`. Content is centered and capped for tablets. Screen padding 16 dp, inter-item spacing 16 dp, bottom 24 dp. This is the most consistent decision in the codebase.

**Shared state components** (`ui/common/KonduktStateCard.kt`) — five tones: `EMPTY` (`SearchOff`, `surfaceContainerLow`), `ERROR` (`ErrorOutline`, solid red, white text), `WARNING` (`Info`, solid yellow, black text), `INFO` (`CheckCircle`, solid orange, black text), `LOADING` (pulsing bus icon alpha 0.55↔1.0 at 900 ms plus spinner). Every screen routes its states through these, so loading/empty/error look identical app-wide.

**Touch targets** — 48 dp minimum everywhere: back arrows, icon buttons, quantity steppers, filter buttons. Primary CTAs are `heightIn(min = 56.dp)`.

**Accessibility** — consistently applied, not bolted on:
- Every interactive card sets `contentDescription` composed as `"<label>. <purpose>"`.
- `heading()` semantics on every section title and top-bar title.
- `Role.Button` / `Role.Checkbox` on custom clickable surfaces.
- `stateDescription` for live values (theme selection, quantity, `Status: in progress`).
- Lists use `semantics(mergeDescendants = true)` so a ticket card is announced as one sentence, not six.
- `maxLines` + `TextOverflow.Ellipsis` on essentially every `Text` — long place names cannot break layout.

**Responsiveness** — font scale and width are first-class. Three thresholds recur: `fontScale > 1.15` or `width < 340 dp` → stack vertically instead of row; `width >= 340 dp && fontScale <= 1.15` → 2-column grid; Home action cards switch to horizontal layout at card width `>= 180 dp`.

**Offline statement pattern** — configuration screens end with an `OFFLINE STORAGE` card (lock icon, "saved locally and work offline"). Home carries `HOME_STORAGE_STATUS = "LOCAL RECORDS SAVED ON THIS DEVICE"`. Deliberate trust signal for a no-network app, repeated across 6 screens.

---

## 2. Navigation Map

`ui/navigation/Routes.kt` (25 constants) + `KonduktNavGraph.kt`. Start destination: `home`.

```
home
├─ dashboard                      (date-scoped earnings)
├─ trip                           (current trip / start)
│  └─ addTrip                     (origin→destination, SCTEX toggle)
│  └─ tripTickets/{tripId}?readOnly
│     ├─ addTicket/{tripId}
│     │  ├─ …/municipalityPicker?side&selectedId
│     │  └─ …/barangayPicker?side&municipalityId&originId
│     ├─ tripTicketsHistory/{tripId}
│     └─ trip_detail/{tripId}?ticketId
├─ passenger                      (per-trip municipality OD matrix)
├─ history                        (date range × 3 tabs, paged)
└─ settings
   ├─ fare_configuration
   ├─ terminal_configuration → addTerminal | editTerminal/{id}
   ├─ barangay_configuration → addBarangay | editBarangay/{id}
   │                          → addMunicipality | editMunicipality/{id}
   └─ advanced_settings
```

**Return values** — the two pickers are the only cross-screen state handoff. They write a `Long` ID into `navController.previousBackStackEntry.savedStateHandle` under `PickedFromBarangayId` / `PickedToBarangayId` / `PickedFromMunicipalityId` / `PickedToMunicipalityId`; `AddTicketRoute` observes all four `LiveData` and applies the selection. No global event bus, no shared mutable state.

**Nav-level state** — `KonduktNavGraph` owns `operationMessage` and `pendingHistoryMessage`, hoisted above the `NavHost` so a snackbar raised by one screen survives back navigation.

---

## 3. Screen Inventory

### 3.1 Home — `home`
**Files:** `ui/home/HomeScreen.kt` (577) · `HomeMenu.kt` · composable inside `KonduktNavGraph` (no ViewModel)

**Function.** Launcher, and the only place the app decides what is possible *right now*. Reads `container.trips.active` and `container.transactions.observeForTrip(trip.id)` directly, rendering one of two realities: no trip, or a live trip with running totals.

**Design.**
- `LazyVerticalGrid`, `GridCells.Fixed(homeActionGridColumns(maxWidthDp, fontScale))` → 2 columns when `width >= 340dp && fontScale <= 1.15`, else 1. Full-width rows use `GridItemSpan(maxLineSpan)`. Insets handled with `safeDrawing`.
- Header row: 48 dp rounded-square orange logo mark, `KONDUKT` wordmark + "Smart fare control" tagline, live date/time right-aligned. The clock is a `repeatOnLifecycle(RESUMED)` loop with `delay(60_000)` — ticks once a minute, not once a second, and stops when the app backgrounds.
- **Trip status hero** — `primaryContainer` card, min height 276 dp idle / 300 dp active. Label flips `NO ACTIVE TRIP` ⇄ `TRIP IN PROGRESS`. Active adds `Trip #n · <km>` plus three metrics (TICKETS / PASSENGERS / EARNINGS) in a row, or a stacked column when `width < 340dp || fontScale > 1.15`. One full-width 56 dp button is state-driven in icon *and* label: `PlayArrow`+`START TRIP` when idle, `ConfirmationNumber`+`RECORD FARE` when active.
- **Quick actions** — six cards from `homeMenuItems()`, order fixed: DASHBOARD, TICKETS, TRIP, PASSENGER, HISTORY, SETTINGS. This 2×3 order is an explicit product invariant (`PRODUCT.md`). Card is 104 dp tall in horizontal mode (icon / text / chevron) and 132 dp in vertical mode (icon + chevron on row 1, text below). DASHBOARD / TICKETS / TRIP get orange accent, the rest `tertiary`.
- TICKETS is the only adaptive item: with no active trip its purpose text becomes "Start a trip before recording fares" and it routes to `Routes.Trip` instead of the ticket list. The state enum pairs `HomePrimaryAction{CONTINUE_TRIP,START_TRIP}` with `HomeTicketEntry{START_TRIP,ACTIVE_TICKETS}`.
- Footer `LocalStorageStatus` card — `Storage` icon, `HOME_STORAGE_STATUS`, "Your data is stored locally and stays on this device."

**Flag.** `HomeMenuItem.isOperational` (true for TICKETS and TRIP) is carried in data but never rendered — all six cards use identical treatment. Dead distinction.

**Accessibility.** Cards announce `"<Title>. <purpose>"`; the clock announces `"Current date … Current time …"`; `QUICK ACTIONS` is a `heading()`.

---

### 3.2 Dashboard — `dashboard`
**Files:** `ui/dashboard/DashboardScreen.kt` (1121) · `DashboardViewModel.kt` · `dashboard/DashboardModels.kt` · `DashboardCalculations.kt`

**Function.** Date-scoped business summary; the only screen where the *past* is the subject. Tapping the date in the top bar opens a `DatePickerDialog`. The ViewModel cancels the prior observation and re-collects, guarded by a monotonic `requestVersion` so a slow earlier query cannot overwrite a newer result.

**Design.**
- Top bar `DASHBOARD` + subtitle `OFFLINE OVERVIEW · <TODAY | VIEWING MMM D, YYYY>`; the date itself is the click target, labelled `"Select dashboard date …"`.
- Vertical stack in fixed order: status card → `TotalEarningsCard` → `DashboardStatsGrid` → `TRIP EARNINGS` list → `RECENT TICKETS` list. Each list header carries an `OPEN HISTORY` action.
- **Status card is a 4-way state machine** — the most interesting logic in the screen:
  1. Active trip exists → orange `ActiveTripCard` with yellow `IN PROGRESS` pill, route, `trip #n · km`, `"N tickets · M passengers · ₱X collected"`, tap opens the trip.
  2. Today empty but earlier trips exist → `RecentTripFallbackCard` — "MOST RECENT TRIP … Showing the latest completed trip while today's activity is empty", labelled `DATA DATE <date>` so the fallback can never be mistaken for live data.
  3. Historical date, no active trip → `HistoricalStatusCard` "NO ACTIVE TRIP … Completed records for `<date>` are shown below", with a *back to today* action.
  4. Nothing at all → `DashboardReadyCard` "READY FOR THE NEXT TRIP".
- `DashboardStatsGrid` is 4 cards (TRIPS TODAY / COMPLETED TRIPS, TICKETS, DISTANCE, AVERAGE / TRIP), each `heightIn(min = 116.dp)`, `surfaceContainerLow`, 40 dp accent-tinted icon circle, mono value — chunked 2-per-row, or single column when narrow or large-font.
- Empty sections are inline `DashboardMessageCard`s with a `VIEW HISTORY` button, never a bare void.
- Error: `KonduktStateCard(ERROR, "Local dashboard data is unavailable. Try again.", onRetry)` — `retry()` bumps `refreshKey`, which is `combine`d into the state flow.

**State model.** `DashboardUiState(totalEarnings, completedTrips, totalTickets, totalDistanceKm, averageEarningsPerTrip, tripSummaries, recentTickets, activeTrip, isShowingRecentTripFallback, dataDate)`.

**Flag.** When the fallback is active the entire screen relabels — stats read "COMPLETED TRIPS" not "TRIPS TODAY", sections read "TRIP EARNINGS" not "TRIP EARNINGS TODAY", and `dataDate` shifts to the most recent trip's end date. Correctness here is the screen's real job, and the easiest thing to regress.

---

### 3.3 Trip — `trip`
**Files:** `ui/trip/TripScreen.kt` (398) · `TripViewModel.kt` · `TripModels.kt` · `TripComponents.kt`

**Function.** Trip lifecycle hub: what is running, what ran recently, and the entry point to start a new one.

**Design.**
- Top bar `TRIP` + trip start date as a trailing chip.
- `CURRENT TRIP` section: `ActiveTripCard` (orange, `extraLarge`) or `TripEmptyState` (`SearchOff`, "No active trip", "Start a new bus trip to begin recording tickets").
- `ActiveTripCard`: 48 dp bus icon, `Trip #id` in mono, yellow `IN PROGRESS` pill with `contentDescription = "Status: in progress"`, route in bold `headlineSmall` (3-line cap), distance, then two `Metric` columns — `STARTED` (time + date) and `ELAPSED` (`HH:MM:SS`). Then a 56 dp orange `Record ticket` button and a 48 dp outlined `End trip` tinted `error`.
- No trip → an `AddNewTripCard` row (48 dp icon, label, forward chevron, 64 dp min height).
- `RECENT COMPLETED` (only when non-empty): `HistoryRow` cards + a *View all trips* text button → History.
- `End trip` → `AlertDialog` "This trip will move to history." with a red-tinted confirm. On failure, a snackbar carrying a **`RETRY` action label** that re-invokes `endTrip()`. `endErrorKey` increments on every failure so repeated identical failures still re-fire the snackbar `LaunchedEffect`.

**Flag.** `TripViewModel` is fully injectable — `endOperation: suspend (Long, Long) -> Boolean`, `clock: () -> Long`, `ticks: Flow<Long>` — so the elapsed clock and the end-trip failure path are testable without Android. Elapsed is a separate 1 s `StateFlow`, so ticking does not recompose the whole screen.

---

### 3.4 Add Trip — `addTrip`
**Files:** `ui/trip/AddTripScreen.kt` (388) · `AddTripComponents.kt` (706) · `AddTripViewModel.kt` · `AddTripModels.kt`

**Function.** The only way to create a trip. Pick two terminals, optionally flag SCTEX, start.

**Design.**
- Intro card ("Create a New Bus Trip") then an info card ("Make sure the bus is ready…"), both `primaryContainer` / `surfaceContainerLow`, 24 dp inner padding.
- `1. SELECT ROUTE` section: `TerminalSelector("FROM")` → `CompareArrows` swap `IconButton` (enabled only once both ends are chosen) → `TerminalSelector("TO")`.
- Each `TerminalSelector` is a card row: 48 dp place icon, `FROM` label + terminal name + `km` value in mono, dropdown chevron. Opening raises a `ModalBottomSheet` (28 dp top corners, `heightIn(max = 320.dp)` list) with a live search field, a "Currently: …" line, and a check on the selected row. A bottom sheet instead of another route keeps terminal selection navigationally cheap.
- `Use SCTEX fare mode` — `Row.toggleable(role = Checkbox)` wrapping a real `Checkbox` with `onCheckedChange = null`; the row is the touch target, the box is decorative.
- Route distance card: value in `primary` mono `titleLarge`, footnoted "Calculated from the registered terminal KM markers" — the app never hides how a number was derived.
- "Ready to start" summary card: route, validation line, and `Starts at <date> · <time>` from a preview timestamp captured at ViewModel construction.
- Actions: outlined `Cancel` (48 dp) then filled `Start trip` (56 dp, spinner + "Starting…" in flight), disabled until `hasValidRoute`.
- Footer: "Saved locally on this device."

**Validation & submission.**
- Error strings: "Choose a departure terminal.", "Choose a destination terminal.", "Destination must differ from departure."
- `startOperation` vs `startOperationWithSctex` — two injected suspend functions dispatched on the `usesSctex` flag, so SCTEX and standard fare paths stay independently testable.

---

### 3.5 Add Ticket — `addTicket/{tripId}`
**Files:** `ui/triptickets/AddTicketScreen.kt` (934) · `AddTicketViewModel.kt` · `AddTicketModels.kt`

**Function.** The core transaction screen. Pick passenger type, boarding point, destination, quantity; the app computes the fare and writes the ticket. This is where the entire fare engine is surfaced.

**Design.**
- Top bar `ADD TICKET` + back.
- "From" / "To" stepper cards: label (`BOARDING POINT` / `DESTINATION`), current selection, and a `CHOOSE` button. Each opens a **municipality picker route first**, which then offers a barangay picker scoped to that municipality. Selected values arrive via `savedStateHandle` and land on the stepper.
- Passenger type row: 4 chips `REGULAR`, `STUDENT`, `SENIOR CITIZEN`, `PWD`; selected chip filled `primary` with black text. PWD/Student/Senior are only *actually* discounted on deluxe and/or SCTEX trips (see `FareCalculator.specialDiscountBp`), so the UI shows the resulting discount rather than implying the chip alone changes the fare.
- Quantity stepper: `Remove` / mono count / `Add`, 48 dp targets, bounded.
- **Fare breakdown card** — the payload of the screen: `FARE` in `primary` mono `titleLarge`, then rows for base fare, distance, rate/km, minimum-fare floor, any discount, and a bold `TOTAL`. Every intermediate is shown; the app never displays a number it cannot explain.
- `RECORD TICKET` is a 56 dp `primary` full-width button, disabled while `!isReady` or a write is in flight. Success → snackbar with the recorded total. Failure → the `RETRYABLE_STORAGE_ERROR` path from `OperationMessage.kt`.
- "Offline storage" footer.

**Fare engine** (`domain/FareCalculator.kt`) — all arithmetic in integer centavos and thousandths of a km, `Math.*Exact` throughout, so overflow throws rather than silently wrapping. Distance is `|max − min|` of the two km markers. At or below `minimumKmThousandths` the minimum fare applies; above it, `minimumFare + (distance − minimumKm) × rate / 1000` with half-up rounding, then rounded to a whole peso (`.00–.49` down, `.50–.99` up). `rateFor(usesSctex, busType, passengerType)` selects among `sctexDeluxeRatePerKm` / `sctexRatePerKm` / `deluxeRatePerKm` / `ratePerKm`. SCTEX adds `sctexKmAdjustmentThousandths` to the distance. Discounts are basis points clamped to 10 000, applied only to non-`REGULAR` types and only for the deluxe and/or SCTEX flag.

**Dependencies.** `AddTicketViewModel` combines trip, stops, fare settings, SCTEX settings, terminals, and municipalities flows, then writes through `TransactionRepository`.

---

### 3.6 Barangay Picker — `addTicket/{tripId}/barangayPicker?side&municipalityId&originId`
**Files:** `ui/triptickets/BarangayPickerScreen.kt` (275) · `BarangayPickerRoute`

**Function.** Third-hop stop selection, scoped by direction. The screen does no querying itself — the route composable does.

**Design.**
- Top bar + search field, results in a `LazyColumn` (`widthIn(max = 600.dp)`, centered).
- Each row: place icon, name, municipality/province subtitle, trailing chevron; selected row filled `primaryContainer`, announces `selected = true`.
- `isLoading` is deliberately narrow: `trip == null && stops.isEmpty() && terminals.isEmpty()` — a spinner appears only before the *first* emission of any source, never on a later refresh.

**Eligibility rules** (`nearestOriginStop` / `destinationStopsAfterOrigin`, the same predicates as the Add Ticket steppers) — this is not a generic list, it reproduces trip direction rules:
- From-side: scoped to the chosen municipality, the stop nearest the origin terminal, bounded by both terminals.
- To-side: stops after the origin, up to the destination terminal.

**Flag.** `filterBarangaysByQuery` and the eligibility helpers are top-level pure functions, not composables — deliberately extracted so they are unit-testable without a Compose test rule.

---

### 3.7 Municipality Picker — `addTicket/{tripId}/municipalityPicker?side&selectedId`
**Files:** `ui/triptickets/MunicipalityPickerScreen.kt` (180) · `MunicipalityPickerRoute`

**Function.** First hop of destination selection. Filters to `isActive` municipalities only, highlights `selectedId`, returns via the same `savedStateHandle` mechanism.

**Design.** Identical skeleton to the barangay picker — top bar, search, list — with `from`/`to` on `selectedId`. The consistency is deliberate: one control, two resolutions.

**Flag.** `filterMunicipalitiesByQuery` matches `name` *or* `province`; `filterBarangaysByQuery` matches name only. Inconsistent search scope between two adjacent screens.

---

### 3.8 Trip Tickets — `tripTickets/{tripId}?readOnly`
**Files:** `ui/triptickets/TripTicketsScreen.kt` · `TripTicketsViewModel.kt` · `TripTicketsModels.kt` · `TripTicketsComponents.kt` (706)

**Function.** The ticket ledger for one trip. Add, inspect, and open any ticket.

**Design.**
- Top bar `TRIP TICKETS` with the trip start time as a trailing mono chip.
- `TripInformationCard` (route, terminals, trip id, start/end, distance, SCTEX badge when flagged).
- `FareSummaryCard` — tickets sold, passengers, total collected; all mono.
- Chip filter by passenger type, then the ticket list.
- `TicketCard` per row: passenger-type chip, route, municipality pair, timestamps, fare, quantity. `mergeDescendants = true` so the whole card announces as one sentence. Tap opens `trip_detail/{tripId}?ticketId={id}`.
- `AddTicketCard` (dashed drop-zone look, `+` icon) renders **only** when `trip.status == TripStatus.ACTIVE && !readOnly`.
- `NoActiveTripWarning` (yellow `WARNING` card) offers `onGoToTrip` when the trip is missing or already ended.
- "View all tickets" → `tripTicketsHistory/{tripId}`.
- Error: `KonduktStateCard(ERROR, "Trip not found.")`.

**Flag.** `TripTicketsViewModel` owns the filter, while ticket history for the same trip is a *separate* ViewModel on the *separate* history screen — so the two lists can briefly disagree after a write. Acceptable for a single user, but it is duplication.

---

### 3.9 Trip Detail — `trip_detail/{tripId}?ticketId`
**File:** `ui/history/HistoryScreen.kt` (~L1638) — lives inside the history file, not its own

**Function.** Read-only single-trip view, optionally focused on one ticket.

**Design.** Rather than duplicate the ticket UI, this screen **reuses `TripTicketsScreen` with `readOnly = true`** and filters `ticketHistory` down to the one `ticketId` from the query parameter. The `readOnly` flag is what suppresses `AddTicketCard`; there is no second implementation of the ticket list. This is the app's best reuse decision.

**Flag.** The composable sits ~1650 lines into `HistoryScreen.kt`, which is the largest file in the app. A `history/TripDetailScreen.kt` split would cost nothing and make the file navigable.

---

### 3.10 Ticket History — `tripTicketsHistory/{tripId}`
**Files:** `ui/triptickets/TripTicketsHistoryScreen.kt` · `TripTicketsHistoryViewModel`

**Function.** The full, unpaginated, unfiltered ticket list for one trip, reached from "View all tickets".

**Design.**
- Top bar `TICKET HISTORY` via the shared `TripTicketsTopBar(null, onBack, "TICKET HISTORY")` — the `null` start time is why the trailing chip is optional.
- `TicketHistorySectionHeader()` then a `LazyColumn` in the standard 600 dp centered idiom.
- States: `TripHistoryLoadingState` / `TripHistoryErrorState` / `TripHistoryEmptyState` / rows.
- `TicketHistoryRow` taps through to `trip_detail/{tripId}?ticketId={id}` — same destination as the live list, so a ticket is reachable from anywhere.

**Flag.** Three separate `TripHistory*State` composables duplicate what `KonduktStateCard` already provides. Dead abstraction weight.

---

### 3.11 Passenger — `passenger`
**Files:** `ui/passenger/PassengerEntryScreen.kt` (520) · `PassengerComponents.kt` · `PassengerViewModel.kt` · `PassengerModels.kt`

**Function.** Per-trip origin→destination passenger matrix. Answers "where did people get on and where did they get off", aggregated.

**Design.**
- Top bar `PASSENGERS` + subtitle "Select a trip to view passenger flow."
- `TripPicker` — a card listing trips (active first, then completed descending) via a `ModalBottomSheet`; rows are `SelectableTripSurface` with a check on the current selection.
- `FilterMenu` — `PassengerTypeFilter.ALL` plus the four types.
- `PassengerTable` — a real grid, not a list: `Row` headers (municipality, destination columns) over a `LazyColumn` of rows, with a bold total column. Counts are mono.
- Empty states are worded distinctly per cause: "No trips available", "Selected trip unavailable", and the CTA is `GO TO TRIPS`. Counting comes from `observeTicketCount` / `observePassengerCount`, not from loading the rows.

**Flag.** The table is `Row` + `LazyColumn` with manual column widths — it is the one layout in the app that does not adapt to a width or font-scale threshold. On a small phone with a large font this is the most likely screen to clip.

---

### 3.12 History — `history`
**Files:** `ui/history/HistoryScreen.kt` (1650) · `HistoryViewModel.kt` · `ui/stops/StopsScreen.kt` (234, the shared stop row)

**Function.** Long-range inspection. Three tabs, a date range, offset pagination, and a search box. This is the app's most complex screen and the reference implementation for paginated offline queries.

**Design.**
- Top bar `HISTORY` + subtitle "Review completed trips and ticket records".
- **Date range control** — preset chips (`HistoryDatePreset`) plus custom. `HistoryClock` is injected (`SystemHistoryClock` in prod) so "today" is deterministic under test.
- **Tabs** — `HistoryTab.TRIPS` (default), plus tickets and passengers. `SingleChoiceSegmentedButtonRow`; full width when `maxWidth >= 360.dp`, else the tabs scroll.
- **Compact mode** — when `maxHeight < 640.dp || fontScale > 1f` the whole screen switches to a compact dialog-style range picker. This is a real, tested accommodation, not a theoretical one.
- **Filters** — free-text `query`, a status filter, and a passenger filter.
- **Pagination** — per-tab `offsets` map, `inFlight: Set<RequestKey>` guarding duplicate page requests, and a `refreshKey` for pull-to-refresh. Loading more is a footer spinner, not a full-screen state; this is the one screen where the shared `KonduktStateCard` pattern is deliberately *not* used, because a full-screen loading card during page 2 would destroy the scroll position.
- Rows: `HistoryRow` for trips (route, dates, ticket count, earnings), ticket rows and passenger rows for the other tabs.
- Error string: `"Local trip data is unavailable."`, with `onRetry` wired to `refreshKey`.

**Flag.** `offsets` is a plain `mutableMapOf<HistoryTab, Int>`; concurrent page requests for the same tab would race. `inFlight` prevents that at the ViewModel level, but the key type must include the query/status filters or a filter change mid-scroll can apply a stale offset.

---

### 3.13 Settings — `settings`
**File:** `ui/settings/SettingsScreen.kt`

**Function.** The hub. Four entries, each leading to one configuration domain.

**Design.**
- Top bar `SETTINGS` + subtitle "Configure your Kondukt workspace".
- Four `SettingsRow` cards in the standard centered column: **Fares** (`Payments` icon, "Minimum fare, rates, and discounts"), **Terminals** (`DirectionsBus`, "Route terminals and kilometer markers"), **Locations** (`LocationOn`, "Barangays and municipalities"), **Advanced** (`Tune`, "Theme and other preferences").
- Each row: 48 dp accent-tinted icon circle, bold title, body, forward chevron, 64 dp min height. Fares gets `primary`, the rest `tertiary`.
- Several rows show a `Lock` icon in the trailing slot. This is the offline-consistency message: settings live on the device.
- Footer: "All settings are stored locally on this device." with the same lock treatment.

**Flag.** The `Lock` icon appears on some rows and not others with no stated rule. Either it is meaningful (locked vs editable) and the semantics are undocumented, or it is decoration. Given every setting *is* editable, it currently reads as misleading.

---

### 3.14 Advanced Settings — `advanced_settings`
**File:** `ui/settings/AdvancedSettingsScreen.kt`

**Function.** Theme selection, and the only place the light/dark decision is made.

**Design.**
- Top bar `ADVANCED` + subtitle "Theme and other preferences".
- Appearance section: two large selectable cards, `DarkMode` and `LightMode` icons, label, `stateDescription` on the selected one. The selected card is filled `primaryContainer` with a check.
- Choosing a row applies immediately and calls `onSaveTheme(isDark)`, which is hoisted to `KonduktNavGraph` and persisted through `ThemePreferences`. No Apply button, no confirmation dialog.
- Footer card repeats the offline-storage statement.

**Flag.** Immediate application with no confirm is right for a two-option toggle. The real gap is that `AdvancedSettingsScreen` is named for "Advanced" but contains exactly one setting.

---

### 3.15 Fare Configuration — `fare_configuration` (also reachable at `fare_settings`)
**Files:** `ui/faresettings/FareSettingsScreen.kt` · `FareConfigurationViewModel.kt` · `data/repository/FareConfigurationDataSource.kt`

**Function.** Every number the fare engine reads. Ten fields, validated as a unit, saved atomically.

**Design.**
- Top bar `FARE SETTINGS` + subtitle "Tune how fares are calculated".
- Numbered sections so the ten inputs read as a specification, not a form: `1. BASE FARE` (minimum fare, minimum distance), `2. REGULAR RATES` (rate/km, special rate/km), `3. DELUXE` (deluxe rate/km, deluxe discount), `4. SCTEX` (SCTEX rate/km, SCTEX deluxe rate/km, SCTEX discount, SCTEX km adjustment), `5. SPECIAL FARES` (special rate).
- Each row is a `LabeledMoneyField` / `LabeledDecimalField` using `konduktGlassFieldColors()` — glass-tinted field fill, orange focus border.
- Validation is per-field and simultaneous: `FareFieldErrors` holds ten nullable error slots, and *all* violations highlight at once rather than surfacing one at a time on blur. Error copy is specific ("Enter a value of 0 or more.", "Enter a value between 0 and 100.").
- Save is a single 56 dp button, disabled until `isValid`, with an in-flight spinner. On failure the snackbar uses `RETRYABLE_STORAGE_ERROR`.
- Footer: `OFFLINE STORAGE` card, "Fare settings are saved locally and work offline."

**Data model.** `FareConfigurationUiState(minimumFare, minimumDistance, ratePerKm, sctexRatePerKm, deluxeRatePerKm, sctexDeluxeRatePerKm, specialRate, deluxeDiscount, sctexDiscount, sctexKmAdjustment)`. Money is held as `BigDecimal` and converted with explicit `RoundingMode`; percentages are clamped to 0..100 at the ViewModel boundary. On save, centavos are derived here, not at read time in `FareCalculator` — the calculator receives only `Long`s.

---

### 3.16 Terminal Configuration — `terminal_configuration`
**Files:** `ui/terminals/TerminalConfigurationScreen.kt` (350) · `TerminalConfigurationViewModel.kt` · `data/repository/TerminalConfigurationDataSource.kt`

**Function.** The list of route terminals. A terminal is a name plus a `kmMarker` — the number every fare depends on.

**Design.**
- Top bar `TERMINALS` + subtitle "Manage route terminals and kilometer markers".
- `TerminalFilter{ALL,ACTIVE,INACTIVE}` chip row.
- List sorted by `kmMarker` then `id` — ascending, not alphabetical. Sorting by distance is the correct order for a route list, and the `then id` tiebreaker makes the order stable across reloads.
- Each row: terminal icon, name, `kmMarker` in mono, an `ACTIVE`/`INACTIVE` status chip, tap → `editTerminal/{id}`.
- `+ ADD TERMINAL` is a 56 dp `primary` button after the list, not a FAB — consistent with every other "create" affordance in the app.
- Empty state: `KonduktStateCard(EMPTY)` naming the missing thing ("No terminals yet", "No active terminals").

**Flag.** Nothing warns that changing a terminal's `kmMarker` retroactively alters the computed distance of every past trip on that route. The number is a historical fact once trips reference it. This is the single most consequential editing action in the app and it is currently unremarkable.

---

### 3.17 Terminal Editor — `addTerminal` / `editTerminal/{terminalId}`
**Files:** `ui/terminals/TerminalEditorScreen.kt` (275) · `TerminalConfigurationViewModel.kt`

**Function.** Create or edit one terminal.

**Design.**
- Top bar `ADD TERMINAL` / `EDIT TERMINAL` — derived from whether an id is present, so one composable serves both routes.
- Two fields: terminal name (text) and kilometer marker (decimal, mono). `kmMarker` is the field that matters, so it carries an explicit hint: the distance between two terminals is derived from the difference of their markers.
- A live "CURRENT" summary line for edit mode shows the existing value so the user is editing against a known baseline.
- Actions: outlined `Cancel` (48 dp) then filled save (56 dp). In edit mode there is an additional destructive `DEACTIVATE` action, tinted `error` and confirmed by a dialog — deactivation is preferred over deletion because past trips still reference the row.
- Errors appear inline under their field; save is disabled while invalid or in flight.
- Footer: offline-storage card.

**Flag.** No hard delete anywhere. Correct for referential integrity, but the UI never says so, so a user looking for "remove" will not find an explanation.

---

### 3.18 Barangay / Municipality Configuration — `barangay_configuration`
**Files:** `ui/locations/BarangayConfigurationScreen.kt` (462) · `LocationConfigurationScreen.kt` · `BarangayConfigurationViewModel.kt` · `ui/locations/MunicipalitySelector.kt` · `data/repository/LocationConfigurationDataSource.kt`

**Function.** Two reference tables behind one screen: barangays (stops) and municipalities, each with its own tab.

**Design.**
- Top bar `LOCATIONS` + subtitle "Manage barangays and municipalities".
- `LocationTab{BARANGAYS,MUNICIPALITIES}` — the barangay tab is the default, which matches how the app is actually used (stop selection dominates).
- `LocationStatusFilter{ALL,ACTIVE,INACTIVE}` chip row mirrors the terminal screen exactly. The parallel is intentional and is the strongest internal consistency in the app.
- Barangay rows carry the parent municipality as a subtitle; municipality rows carry the province. Both show an `ACTIVE`/`INACTIVE` chip.
- Two full-width 56 dp `+ ADD BARANGAY` / `+ ADD MUNICIPALITY` buttons.
- `MunicipalitySelector` (`ExposedDropdownMenuBox`) is embedded rather than routed: it filters on `name` *or* `province`, shows `"Add a municipality first"` as the placeholder when the list is empty, and sets `readOnly` plus an inline "No active municipalities. Add one in Municipality Configuration." message in that case. The dependency is stated in the copy rather than hidden.

**Flag.** An active barangay whose municipality is inactive is not prevented. Add Ticket filters municipalities to `isActive`, so such a barangay becomes unreachable in the picker while still counted in configuration — a silent data-visibility split.

---

### 3.19 Location Editor — `addBarangay` / `editBarangay/{id}` / `addMunicipality` / `editMunicipality/{id}`
**File:** `ui/locations/LocationEditorScreen.kt` (409)

**Function.** Create or edit one barangay or one municipality, selected by the route the user arrived on.

**Design.**
- One composable, four routes, branching on the `LocationEditorState` it receives. Title and save action both adapt: `ADD BARANGAY` / `EDIT BARANGAY` / `ADD MUNICIPALITY` / `EDIT MUNICIPALITY`.
- Barangay mode: name, the embedded `MunicipalitySelector`, and a km-marker hint. Municipality mode: name + province.
- Every field uses `konduktGlassFieldColors()`; `isError` on the municipality field keys off `state.error != null && state.municipalityId == null` so a submitted-but-unset dropdown is distinguishable from a pre-existing error.
- Actions match the terminal editor: outlined `Cancel` (48 dp), filled save (56 dp, in-flight spinner), plus a red `DEACTIVATE` in edit mode behind a confirm dialog.
- Footer: offline-storage card.

**Flag.** This is the clearest case in the codebase of one composable honestly covering four routes rather than four near-duplicate composables. The counter-example is `TripDetailScreen`, which should have done the same.

---

## 4. Current Trip — `current_trip` (dead)

**File:** `ui/currenttrip/CurrentTripScreen.kt` · registered in `KonduktNavGraph` at L54

**Function.** Intended as a dedicated live-trip view. It is registered as a route but **nothing navigates to it** — `grep` for `Routes.CurrentTrip` returns exactly one hit, the `composable(...)` registration itself. Home's hero and Trip screen both cover this ground, and the Trip screen does it with the injected `ticks` flow that this one lacks.

**Status.** Unreachable. Candidate for deletion; see §6.

---

## 5. `ui/stops/StopsScreen.kt` — orphaned, not routed

**File:** `ui/stops/StopsScreen.kt` (234)

**Status.** `StopsScreen(container, onBack)` is a public composable that is never called. `Routes.Stops` is declared in `Routes.kt` but has **no `composable(Routes.Stops)` registration** in the NavGraph, and nothing references it. This is the old stop list, superseded by `BarangayConfigurationScreen`.

The only thing still borrowed from the area is the stop *row* — `HistoryScreen.kt` reuses a row composable from this file for its history list, so the file cannot be deleted wholesale without moving that row.

---

## 6. Findings & Dead Code

| # | Finding | Location | Impact |
|---|---|---|---|
| 1 | `Routes.Stops` declared but never registered; `StopsScreen` never called | `Routes.kt`, `StopsScreen.kt` | dead route + dead screen. Stop-row composable is still used by History, so delete the screen, keep/move the row. |
| 2 | `Routes.FareSettings` is a duplicate route to the same `FareConfigurationRoute` as `Routes.FareConfiguration` | `KonduktNavGraph.kt:146` | two URLs, one screen. Settings navigates to `FareConfiguration`; the other is unreachable-by-accident. Delete one. |
| 3 | `Routes.CurrentTrip` registered, never navigated to | `KonduktNavGraph.kt:54` | unreachable screen, ~dead weight. |
| 4 | `HomeMenuItem.isOperational` computed but never rendered | `HomeMenu.kt` | data field implies two card styles that do not exist. |
| 5 | `TripHistoryLoadingState` / `TripHistoryErrorState` / `TripHistoryEmptyState` duplicate `KonduktStateCard` | `TripTicketsHistoryScreen.kt` | three bespoke components doing one existing job. |
| 6 | `TripDetailScreen` lives inside `HistoryScreen.kt` at ~L1638 | `HistoryScreen.kt` | 1650-line file. Split to `history/TripDetailScreen.kt`. |
| 7 | `Lock` icon on some Settings rows, not others, with no rule | `SettingsScreen.kt` | reads as "locked" but every setting is editable. |
| 8 | Editing a terminal `kmMarker` silently changes the derived distance of past trips | `TerminalEditorScreen.kt` | historical correctness risk; no warning, no snapshot. |
| 9 | Barangay can be active while its municipality is inactive | `BarangayConfigurationViewModel.kt` | the barangay is then unselectable in Add Ticket but still listed in configuration. |
| 10 | `filterMunicipalitiesByQuery` searches name + province; `filterBarangaysByQuery` searches name only | the two picker files | inconsistent search behaviour on adjacent screens. |
| 11 | `PassengerTable` uses fixed-width `Row`s with no width/font-scale threshold | `PassengerComponents.kt` | only layout in the app that can clip at large font. |
| 12 | Ticket list (`TripTicketsViewModel`) and ticket history (`TripTicketsHistoryViewModel`) are separate caches of the same data | two ViewModels | can briefly disagree after a write. |
| 13 | `AdvancedSettingsScreen` contains exactly one setting | `AdvancedSettingsScreen.kt` | name promises more than it delivers. |

**Non-issues worth naming** (looked like problems, are not):
- `Routes.PickedFromBarangayId` / `PickedToBarangayId` / `PickedFromMunicipalityId` / `PickedToMunicipalityId` — all four *are* used, by `BarangayPickerScreen.kt`, `MunicipalityPickerScreen.kt`, and `AddTicketScreen.kt`. Not dead.
- Elevation `0.dp` everywhere — deliberate, not an oversight. `KonduktGlassCard` is the sole exception and it animates depth intentionally.
- `flatMapLatest` + `requestVersion` in `DashboardViewModel` and `HistoryViewModel` — more machinery than a naive app needs, but this is a data-correctness guard against out-of-order offline queries. Justified.
- `internal constructor` + nested `Factory` on every ViewModel — verbose, but it is what makes each screen testable with fakes. Consistent across all ten ViewModels.

---

## 7. Cross-Cutting Architecture Notes

**State pattern.** Every screen follows one shape, applied identically ten times:
1. `MutableStateFlow` inputs (query, filters, date, selection).
2. `combine` / `flatMapLatest` over repository flows.
3. One immutable `XUiState` data class — no null-object fields, no ad-hoc flags.
4. `stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000))`.
5. `internal constructor(...)` for tests + a public constructor taking repositories, plus a nested `Factory` `ViewModelProvider.Factory`.

Consistency here is a genuine strength: a new screen has an obvious template to copy.

**Data layer.** `AppContainer` (no DI framework — manual construction, which is the right call at this size) builds Room with 13 explicit migrations `MIGRATION_1_2` … `MIGRATION_12_13` and a `DatabaseBootstrap.callback` that seeds first-run reference data. Repositories: `BarangayRepository`, `TerminalRepository`, `FareSettingsRepository`, `SctexSettingsRepository`, `TripRepository`, `TransactionRepository`, `DashboardRepository`, `HistoryRepository`, plus `ThemePreferences` on DataStore-equivalent prefs.

**Domain layer** is three files: `FareCalculator.kt`, `FareModels.kt`, `FareValidation.kt`. Pure Kotlin, no Android imports, integer-only money math. Because the calculator takes `Long` centavos and `Long` km-thousandths, it is trivially unit-testable and cannot lose precision.

**`OperationMessage.kt`** centralizes the snackbar-after-a-failed-write contract, including the `RETRYABLE_STORAGE_ERROR` message and its `RETRY` action label. Trip, Add Trip, Add Ticket, and Fare Configuration all use it, so a storage failure looks and behaves the same everywhere.

**`Formatters.kt`** provides `php()`, `km()`, and `duration()`. Every peso value, every distance, and every duration in the app goes through these three functions, which is why numbers are formatted identically on Home, Dashboard, Trip, Tickets, and History.

**Accessibility posture.** Genuinely good and unusually consistent for a personal app: `heading()` on every section, `mergeDescendants` on every list row, `stateDescription` on every live value, `contentDescription` on every custom card, `role` on every custom toggle, 48 dp minimums everywhere, and explicit `fontScale > 1.15` responsive branches. `PRODUCT.md` says no standard was established — the de facto bar was simply "native Android semantics", and the app meets it.

**Where it is weak.** The gap is not accessibility or state handling; it is *data history*. Screens are careful about showing current truth (dashboard fallback labelling, fare breakdowns, terminal km provenance), but nothing protects past truth when reference data is edited — finding #8 is the clearest instance.
