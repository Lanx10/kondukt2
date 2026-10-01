# UI audit — reference HTML vs React Native Expo

Scope: rendered interface only. Reference prototypes are evidence, not authority.
Data/business/backend: untouched. Trip numbers missing from Dashboard rows are a
data-availability limitation (see Dashboard) — NOT MODIFIED.

## SCREEN: Home
REFERENCE: home.html
CURRENT: src/screens/HomeScreen.tsx (+ components/home/*)

REFERENCE ELEMENTS PRESENT IN CURRENT: header + "KONDUKT"/status, hero (5 states),
last trip card, quick actions grid, storage note, footnote.
INTENTIONALLY REMOVED / REFERENCE-ONLY: "unbuilt config" dashed note, QA "extra" tile.
ACTUAL DEFECTS FOUND: hero action labels were ALL-CAPS; elapsed shown as HH:MM:SS
where the reference prints compact "1h 18m".
CORRECTIONS: labels → sentence case (src/screens/HomeScreen.tsx);
`formatDurationShort` added to src/lib/tripScreenFormat.ts (pill + hero when line).
`formatElapsed` kept for the Trip screen.
REGRESSION: live snapshot — "#6 · 13h 45m", buttons "Record a fare" / "Trip details".
STATUS: CORRECTED.

## SCREEN: Dashboard
REFERENCE: dashboard.html
CURRENT: src/screens/DashboardScreen.tsx (+ components/dashboard/*, PeriodControl,
SummaryDisclosure, LedgerRow, StatusCard)

REFERENCE ELEMENTS PRESENT IN CURRENT: chrome, status slot (5 states), PERIOD card
(segments + calendar + stepper), range caption, summary card (hero + disclosure +
stat grid + breakdown), scope TRIPS (6 rows, Open History), scope TICKETS (6 rows),
storage note, footnote, range calendar modal.

INTENTIONALLY DIFFERENT / NOT CHANGED:
- Trip row fare placement: reference dashboard puts the bold fare in the row meta
  line; the app uses the History reference's shape (EARNINGS label + amount in the
  side column). One LedgerRow serves both screens — intentional consolidation.
- Empty lists use a single-line inline card instead of the reference's
  title + body state-card. RN adds "Show today" through the pressable period
  caption, so the reference's extra button is not restored.
- Eyebrow chip reads "RUNNING" where the reference prints "TRIP #<n>": the
  Dashboard's view type (`konduktStore.Trip`) carries no trip_number. Adding it
  would touch the data layer — BACKEND/DATA CHANGE REQUIRED — NOT MODIFIED.
  Same limitation removes "Trip #n" from the trip row sub and the ticket row sub.

ACTUAL DEFECTS CORRECTED:
1. Status action labels were ALL-CAPS ("TRIP DETAILS", "START A TRIP") where the
   reference prints sentence case ("Trip details", "Start a trip") — the same
   defect fixed on Home. → DashboardScreen.
2. Running-trip body repeated the READY card's copy and printed the start time
   with seconds ("6:30:00 AM"). Reference body: "started 6:30 AM". → now
   `Started ${formatShortTime} ·` with the route's date line unchanged.
3. Running-trip meta omitted the distance the reference prints. → km added between
   passengers and the collected figure (omitted when 0, nothing to report).
4. Running-trip action carried an arrow icon; the reference ghost button is text
   only. → StatusCard now renders the action whenever `actionLabel` + `onPress`
   are given; the icon stays optional.
5. Fallback chip printed a bare date; reference prints "DATA DATE · OCT 14".
6. Empty status title read "No records in this window"; reference reads
   "No trips in this window".
7. The period caption repeated the stepper's dates ("Showing Mon, Sep 28 · 12:00
   AM – 11:59 PM"). The reference's Dashboard caption states what the window holds
   ("2 completed trips · 8 tickets recorded · Trip #210 running."); the dates form
   is History's. → PeriodControl gained an optional `caption` prop; Dashboard
   supplies counts, the empty line, or the fallback "Data is from <day> — today
   has no records yet."
8. The section label above the summary card was missing (reference: "TODAY
   EARNINGS"; History already has "SUMMARY — <scope>"). → SectionHeader added;
   the hero caption dropped its scope suffix so head and caption both read
   "TOTAL EARNINGS", as in the reference.
9. Ticket rows printed category and fare but no quantity; reference ends the sub
   line "· Qty 1". → appended in components/dashboard/Rows.tsx.
10. Period segments announced no selection on the web build (react-native-web maps
    only the `aria-checked` prop, not `accessibilityState.checked`).
    → `aria-checked` added alongside accessibilityState; native behaviour unchanged.

REGRESSION: `npx tsc --noEmit` clean, `npx expo lint` clean; live Dashboard
snapshot — status "Started 6:30 AM." / "4 tickets · 6 passengers · 86.2 km ·
₱836.14 so far" / "Trip details"; caption "1 completed trip · 7 tickets recorded ·
Trip running."; headings TODAY EARNINGS / TOTAL EARNINGS / ₱1,136.14; ticket rows
carry "· Qty n"; Day radio reports checked.
STATUS: CORRECTED.

## SCREEN: Trip
REFERENCE: trip.html
CURRENT: src/screens/TripScreen.tsx
PRESENT IN BOTH: chrome, five card states (running / idle / empty / loading / failed),
RECENT COMPLETED TRIPS + view-all, storage note, footnote, end-trip dialog.
NOT CHANGED: the running card drops the reference's second "Running for HH:MM:SS"
line (the ELAPSED figure counts the same seconds — documented intent); the storage
note is the app's generic LocalStorageCard, because a count-based note would need a
whole-store read this screen deliberately does not make.
DEFECTS FIXED: chrome subtitle "Route and fares" was missing (added with the
reference's 56px title pill); section label and view-all link were sentence case
where the reference prints "RECENT COMPLETED TRIPS" / "VIEW ALL" (caps, a11y label
kept sentence case).
REGRESSION: live snapshot — subtitle, heading, "VIEW ALL" present; rows unchanged.
STATUS: CORRECTED.

## SCREEN: Current Trip
REFERENCE: current-trip.html
CURRENT: src/screens/CurrentTripScreen.tsx
PRESENT IN BOTH: chrome with per-state subtitle, state slot, run card (RUNNING pill,
passengers + collected, passenger-mix track, six detail rows, provenance note),
BOARDINGS ledger with count, storage note, End trip action bar as a sibling of the
scroll area, end-trip sheet.
NOT CHANGED: "Express way" for the reference's "SCTEX" (rename); the app's own
longer state/storage copy (redesign, all the same facts).
DEFECTS: none found.
STATUS: PASS.

## SCREEN: Add Trip
REFERENCE: add-trip.html
CURRENT: src/screens/AddTripScreen.tsx
PRESENT IN BOTH: chrome + dynamic subtitle, ROUTE card (origin/swap/destination,
leg distance), ROAD card, WHAT THIS TRIP WILL BILL card with Rules link, no-rules
state, commit button + hint, storage footer, terminal sheets.
NOT CHANGED: the commit label adds the trip number the reference keeps in the
subtitle; the estimate card has three rows, not four — the reference's
"SCTEX adjustment" row has no counterpart because the app's fare rules hold no
expressway km adjustment. BACKEND/business-logic difference — NOT MODIFIED.
DEFECTS: none found. STATUS: PASS.

## SCREEN: Add Ticket
REFERENCE: add-ticket.html
CURRENT: src/screens/AddTicketScreen.tsx
PRESENT IN BOTH: chrome, boarding/destination fields, ROAD, PASSENGER + quantity,
fare card, "Record ₱X ticket" commit, RECENT TICKETS, sheets.
NOT CHANGED: the card header reads PASSENGERS (the app's card also carries the
quantity stepper; the reference's singular was for a category-only card).
DEFECTS: none found. STATUS: PASS.

## SCREEN: Trip Tickets
REFERENCE: trip-tickets.html
CURRENT: src/screens/TripTicketsScreen.tsx
DEFECTS FIXED: missing chrome subtitle "Trip and ticket overview"; ledger heading
and link printed sentence case instead of "TICKET LEDGER" / "VIEW ALL".
Rows (time, date, category, "₱ each · n pax", fare, #id) already matched.
REGRESSION: live snapshot — subtitle, TICKET LEDGER, VIEW ALL present.
STATUS: CORRECTED.

## SCREEN: Passenger
REFERENCE: passenger.html
CURRENT: src/screens/PassengerScreen.tsx
NOT CHANGED: the reference's "ALL GROUPS" sheet — the app caps the list and says
how many it hid, which is the same job in one screen.
DEFECTS FIXED: missing chrome subtitle "Passenger overview"; heading printed
"Boarding groups" instead of "BOARDING GROUPS"; the trip card's accessible label
said "1 boarding groups" (unpluralised counts).
REGRESSION: live snapshot — subtitle, heading, privacy note all correct.
STATUS: CORRECTED.

## SCREEN: History
REFERENCE: history.html
CURRENT: src/screens/HistoryScreen.tsx
DEFECTS FIXED (the worst of the audit):
1. Every trip and ticket row printed "undefined → undefined" for its route, and
   the same words were announced. The paged queries select the snapshot columns
   under their stored names (and also declare `origin`/`destination` aliases);
   the rows that reach the screen carry only the stored names. Fixed in the
   screen with `historyRoute`, which reads both keys and applies the same
   half-name collapse `tripRoute` uses, so a route reads identically everywhere.
2. Missing chrome subtitle "Trip and ticket history".
3. Ticket rows lost the reference's "· Qty n" run-in.
DATA NOTE: the paged-query row types in src/data/historyStore.ts declare the
`origin`/`destination` aliases, which the rows do not carry. Typing/Data layer —
reported, not modified.
REGRESSION: live — trips and tickets tabs print real routes; a11y labels fixed.
STATUS: CORRECTED.

## SCREENS INSPECTED, NO CHANGE NEEDED
- ticket-history.html / TicketHistoryScreen — chrome, one trip's ledger, states.
- ticket-history-detail.html / TicketDetailScreen — "THE TRIP IT WAS TAKEN ON",
  "THE RECORD", fact rows.
- settings.html / SettingsScreen — CONFIGURATION, not-set-up block, module rows.
- advanced-settings.html / AdvancedSettingsScreen — APPEARANCE, HOW THIS SAVES.
- fare-config.html / FareSettingsScreen — WHAT IT COSTS, MINIMUM CHARGES,
  FARE PER KM, DISCOUNTED FARE PER KM.
- terminal-config.html / TerminalConfigScreen — search + status caption, TERMINALS
  section with ADD TERMINAL, offline note.
- barangay-config.html / BarangayConfigScreen — BARANGAYS / MUNICIPALITIES tabs.
- add-terminal / add-barangay / add-municipality — subtitles and field sets match
  TerminalEditorScreen, BarangayEditor, MunicipalityEditor.
STATUS: PASS.

## PASS: vertical rhythm + left/right gutters (Dashboard as the yardstick)
Measured live in the preview (rendered rects, not source): every screen's cards
measured against the Dashboard — 20px in from both edges, 20px above a section,
12px between rows inside a section. The references agree: `--section-margin: 20px`,
`--card-gap: 12px`, `.section-head { margin-bottom: 10px }`, add-trip/add-ticket
`.card { margin-top: 20px }`, `.readable { padding-inline: 20px }`.

DEFECTS FIXED:
1. src/components/LocalStorageCard.tsx — the footer card had no top margin, so on
   Trip and Trip Tickets it touched the last row (gap 0). Now marginTop 20,
   the same space StorageNote keeps.
2. src/screens/PassengerScreen.tsx — the privacy card carried its own 16px
   override; the shared 20 now applies (override removed).
3. src/screens/TripScreen.tsx, src/screens/TripTicketsScreen.tsx — section heads
   sat 24px below the previous card with an 8px gap under the heading, where the
   Dashboard's SectionHeader uses 20/12. Now 20/12; measured header→row gap 24,
   identical on both screens and on the Dashboard.
4. src/screens/TicketDetailScreen.tsx — its column padded 16px horizontally and 8px
   under the chrome, so it was the only screen whose cards did not line up with
   the rest of the app (the reference's `.readable` is 20/20, as its own comment
   said). Now 20/20; cards measure x=20, w=367 on a 407px viewport.

VERIFIED CORRECT, UNCHANGED: Home (quick-action tiles reach the same 20px edge
through the grid's 14 + 6 cell padding, by design), Dashboard, History
(12/20 throughout), Current Trip (gutter 20, card internals 12), Passenger,
Add Trip and Add Ticket (20px card rhythm, per the references' `.card`),
Settings / Advanced / Fare / Terminal / Barangay and the three editors
(container padding 20, sections 20; their smaller 8/12/16 values are internal
sub-spacing, not card-to-card).
STATUS: CORRECTED.

## PASS: passenger-type button rows — pills that share the full width
Every screen that offers the Regular / Student / Senior / PWD set: Add Ticket's
PASSENGERS card, Passenger's fare-type filter, History's per-tab filter (trips and
tickets). All three built their pills content-sized inside a `flexWrap: 'wrap'`
row, so the right edge was ragged, a 44×44 minimum made the short ones read as
circles, and at a large font scale the row wrapped and pushed everything below it
down for nothing.

CORRECTIONS (measured live, 407px viewport):
- Rows are now single-line, no wrap; every pill is `flex: 1` with `minWidth: 0`
  and 44px height, so the set spans the card/screen width edge to edge.
  Add Ticket 4 pills ≈ 75–77px; Passenger 5 ≈ 67–69px; History 5 ≈ 65–77px;
  History trips 3 ≈ 113–125px — all at x=20 through x=387.
- Selected state no longer trades 1px of padding for its 2px border (the width is
  flex-driven, so the compensation only shifted the label).
- History's chips read "All" and "Senior" instead of "All types" / "Senior
  citizen" so five pills fit one row; the full category names stay in each
  chip's accessible name ("Filter: senior citizens", "Filter: passengers with a
  disability"), and Passenger already worked this way.
REGRESSION: `npx tsc --noEmit` and `npx expo lint` clean; Add Ticket, Passenger
and History (both tabs) measured in the preview.
STATUS: CORRECTED.

## PASS: local-storage card spacing
The footer storage card exists in two components. `StorageNote` (Home, Dashboard,
History) matches the reference note exactly; `LocalStorageCard` (Trip, Trip
Tickets, Passenger's privacy card) did not, and the user flagged it.

MEASURED (407px viewport), before → after:
- padding `16px` all round → `16px 20px` (the reference's
  `.storage-note { padding: 16px 20px }`, and what every other card in the app
  uses). With 16 the text column started 4px inside every other card's, so the
  footer read as a different card.
- icon-to-text distance was a `marginLeft` on the text block; it is now the row's
  own `gap: 12px`, the reference's `.storage-note { gap: 12px }`.
- `alignItems: 'center'` → `'flex-start'`, so the 40px chip sits level with the
  first line instead of floating in a centred block (the reference aligns the
  icon to the top of its sentence).
Card now measures x=20, w=367, padding 16/20, gap 12, align flex-start, marginTop
20 — identical to the StorageNote it sits beside on the other screens.
REGRESSION: `npx tsc --noEmit` and `npx expo lint` clean; measured on Trip and
Passenger. The footnote under it already had its 16px top padding on all three
screens, so no change was needed there.
STATUS: CORRECTED.

## PASS: storage-note page inset on Home and History
The user reported the History storage card's left and right spacing. It was true
there and on Home: the note was rendered full-bleed, edge to edge.

MEASURED before (407px viewport): History and Home both showed the card at
x=0, w=407 — a 407px-wide card whose own 20px padding was the only inset, so its
glass edges never appeared. The Dashboard, which passes
`storageSlot: { marginHorizontal: space(5) }`, was already correct at x=20, w=367.

CAUSE: both screens passed a style that only set a top margin —
History `style={styles.footnote}` (marginTop 20) and Home
`storageSlot: { marginTop: space(4) }` — so the note's own root style
(`marginTop` only) left the horizontal page inset to nobody. Home also lost the
20px top margin to its 16px override.

CORRECTIONS:
- src/screens/HistoryScreen.tsx — the note now takes the page gutter
  (`style={styles.gutter}`) and keeps the component's own 20px top margin.
  Four dead local styles left over from a pre-component implementation of the
  note (storageNote, storageText, storageStrong, footnoteText, footnote) removed.
- src/screens/HomeScreen.tsx — `storageSlot` is now the page inset only; the
  16px top override is gone, so all three screens read 20/20.
REGRESSION: `npx tsc --noEmit` and `npx expo lint` clean; Home, History and
Dashboard measured in the preview — all three now x=20, w=367, padding 16/20,
marginTop 20, marginHorizontal 20, text column at x=70.
STATUS: CORRECTED.

## PASS: Settings OFFLINE STORAGE note got its glass card
User report: the glass card on Settings' local-storage note was missing.

CLASSIFICATION: intentional in the reference — settings.html's `.note-lock` is a
bare `padding: 20px 8px` flex block with no surface, and terminal-config.html and
barangay-config.html do the same, because a note that looks like the four module
cards above it but opens nothing reads as a trap. The app's own running code was
the split: every other storage/privacy footer in the app (Home, Dashboard,
History, Trip, Trip Tickets, Passenger) sits on a glass card, so Settings was the
odd one out. User chose: card on Settings only; Terminal and Barangay keep the
bare note their references specify.

CORRECTION (src/screens/SettingsScreen.tsx):
- The bare `<View>` is now a `GlassCard`, keeping its testID, a11y label and
  no-press semantics — still not a module: no chevron, nothing to tap.
- noteLock padding `20px 8px` → the footer's 16px 20px, gap 8 → 12, so it reads
  as a storage footer rather than a module card with 20px padding.
MEASURED: note x=20, w=367, radius 28, bg rgba(255,255,255,.58), padding 16/20,
gap 12, marginTop 20 — the module cards above measure x=20, w=367, so the card
edges align exactly. Verified by screenshot on Settings.
REGRESSION: `npx tsc --noEmit` and `npx expo lint` clean.
STATUS: CORRECTED (user-directed; reference difference noted).

## PASS: Passenger boarding-group row had no glass surface
User report: the boarding group card on the Passenger screen has no glass card.

CLASSIFICATION: ACTUAL DEFECT. passenger.html renders each ledger row as
`class="glass row-card row-btn"` — a surface (`.glass` tint + rim + shadow) at
`--radius-lg` 16px, min-height 120, padding 20. The RN row used a bare
`<View style={styles.rowCard}>`: padding + layout only, so the one card list in
the app sat directly on the page backdrop.

CORRECTION (src/screens/PassengerScreen.tsx, PassengerGroupRow only):
- Row root → `GlassCard cornerRadius={radius.large} style={styles.rowCard}`,
  same 16px ledger shape as LedgerRow (History) and Trip Tickets' row.
- `rowCard` gained `minHeight: 120` (reference `.row-card`).
- Accessible label carried over unchanged onto the GlassCard root.
MEASURED: row x=20, w=367, radius 16px, bg rgba(255,255,255,0.58), padding 20,
min-height 120, card shadow — gutter matches every other card on the screen.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean; screenshot on the screen.
STATUS: CORRECTED.

## PASS: Fare Configuration offline note got its glass card
User report: the fare configuration local-storage card has no glass card.

CLASSIFICATION: ACTUAL DEFECT (same family as Settings). fare-config.html's
`.note-lock` is a bare block, but every other storage/privacy footer in the
running app — Home, Dashboard, History, Settings, Trip, Trip Tickets, Passenger —
now sits on a surface; Fare was the last one bare, and the user wants it carded.

CORRECTION (src/screens/FareSettingsScreen.tsx, item 6 only):
- Bare `<View testID="fc-storage">` → `GlassCard`, same 16/20 padding, gap 12,
  marginTop 20 treatment as Settings' note; lock icon 16 → 18 to match.
- Kept its non-pressable semantics: no chevron, nothing to tap — still a note,
  never a fifth section. Added a merge-free accessibilityLabel (lock label +
  sentence) so the reader hears one statement.
- noteLock: paddingVertical 20/8 → 16/20, gap 8 → 12, so it reads as a storage
  footer rather than a section card with 20px padding.
MEASURED: x=20, w=367, radius 28, bg rgba(255,255,255,0.58), padding 16/20,
gap 12, marginTop 20, card shadow — aligned with the fare sections above.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean; screenshot verified.
STATUS: CORRECTED.

## PASS: Terminal Configuration offline note got its glass card
User report: terminal configuration local-storage card has no glass card.

CLASSIFICATION: ACTUAL DEFECT (same family as Settings and Fare Config).

CORRECTION (src/screens/TerminalConfigScreen.tsx):
- `<View testID="tc-storage">` → `GlassCard`, same testID/label/semantics.
- noteLock: gap 8 → 12, padding 20px/8px → 16/20, marginTop 20 kept;
  lock icon 16 → 18 to match the other footers.
- Still not a control: no chevron, nothing to press.
MEASURED: x=20, w=367, radius 28, bg rgba(255,255,255,0.58), padding 16/20,
gap 12, marginTop 20, card shadow — aligned with the terminal rows above.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean; screenshot verified.
STATUS: CORRECTED.

## PASS: Advanced Settings offline note got its glass card
User report: parts of the Advanced Settings screen are missing the card
compared to advanced-settings.html.

CLASSIFICATION: ACTUAL DEFECT (same family as Settings, Fare and Terminal).
advanced-settings.html renders `.note-lock` bare (padding 20px 8px, no
surface) — the reference itself has no card here. Every other storage footer in
the running app now does, so this was the last bare one.

CORRECTION (src/screens/AdvancedSettingsScreen.tsx, storage note only):
- `<View testID="as-storage">` → `GlassCard`, same testID/label/semantics.
- noteLock: gap 8 → 12, padding 20px/8px → 16/20, marginTop 20 kept;
  lock icon 16 → 18.
- Still not a control: no chevron, nothing to press.
MEASURED: x=20, w=367, radius 28, bg rgba(255,255,255,0.58), padding 16/20,
gap 12, marginTop 20, card shadow — aligned with the option rows above
(reference `.opt` keeps `background: var(--glass-tint)` at radius-lg; unchanged).
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED.

## PASS: Passenger top card — completed state lost its glass surface
User report: the top big card on Passenger is missing the glass card.

CLASSIFICATION: MIXED. The RUNNING card is amber by design in both versions
(`pass-solid` in passenger.html = `background: var(--secondary)`, rim layers
suppressed; `.pass-solid::before/::after { display:none }`), so that one is not a
defect. The COMPLETED card is `hero-glass` in the reference and a bare `<View>`
in RN — a real defect, invisible while the current trip runs.

ACTUAL DEFECTS FOUND AND CORRECTED (src/screens/PassengerScreen.tsx):
1. Top card: completed trip rendered on a plain View. Split the card into
   GlassCard (not running) / amber View (running), contents hoisted into
   PassengerTripCardBody so both surfaces hold identical content.
   MEASURED on trip #5 (completed): x=20, w=367, radius 28, bg
   rgba(255,255,255,0.58), padding 20, card shadow. Running trip #6 still
   measures bg rgb(255,179,0), radius 28, padding 20, card shadow — the
   reference's pass-solid values exactly.
2. Meta line read "15:12:08 so far" (formatElapsed, HH:MM:SS). Reference
   `elapsedLabel` is a compact human duration. Switched to
   `formatDurationShort` — now "86.2 km · started 6:30 AM · 15h 17m so far".
3. Card a11y label said "2 municipalitys" (naive +s plural). Now "1
   municipality" / "n municipalities".
UNCHANGED (verified present, not defects): eyebrow + TRIP #n pill, card title,
route heading, lead value 28px + PASSENGERS ON THIS TRIP label, the three
FARES/GROUPS/MUNICIPALITIES figures, the Switch trip ghost action, the filter
row, search, BOARDING GROUPS ledger, privacy note, footnote.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean; verified live on both the
running and a completed trip. Trip selection is component state only — no write,
no data change.
STATUS: CORRECTED.

## PASS: Passenger filter row became a glass card; selected pill solid glass
User request (user-directed design change, not a reference defect): wrap the
All/Regular/Student/Senior/PWD row in a glass card and turn the orange active
chip into solid glass.

CORRECTION (src/screens/PassengerScreen.tsx only):
- `<View style={styles.filterRow}>` → `GlassCard cornerRadius={radius.large}`
  wrapping the same row. filterCard: marginTop 20, marginHorizontal 20,
  padding 10 (space(2.5)); the row keeps its 8px gap and flex:1 pills.
- chipSelected: was `accent.primary.container` fill + 2px `primarySolid` orange
  border → `glass.tintStrong` fill + 1px `glass.rim` (a denser glass with a lit
  lip), label `Poppins_600SemiBold` on `onSurface`. Selection reads from ink
  weight, not from a colour that fought the amber running card above it.
MEASURED: card x=20, w=367, radius 16, bg rgba(255,255,255,0.58), padding 10,
marginTop 20, card shadow — aligned with every other card's gutter. Selected
pill bg rgba(255,255,255,0.72), border rgba(255,255,255,0.85); unselected pills
transparent with the shared outline hairline. Both states 1px so choosing a
filter cannot resize a pill under the thumb (the reference's own 4px-grid note).
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean; screenshot verified.
STATUS: CORRECTED (user-directed).

## PASS: Advanced Settings mode options became glass; active is glass orange
User request (user-directed design change): make the Light/Dark mode option
buttons glass, and the active one glass orange.

CLASSIFICATION: DESIGN CHANGE, not a reference defect. advanced-settings.html
paints `.opt` as `background: var(--glass-tint)` with an `--outline` hairline and
`[aria-checked=true]` as `--primary-container` with an accent border — no card
depth, no orange fill. Applied on the user's instruction.

CORRECTION (src/screens/AdvancedSettingsScreen.tsx):
- `option`: `--outline` hairline → `glass.rimFaint` border, plus `cardShadow`,
  so a resting option is a panel at the same depth as every other card.
- `optionSelected`: `palette.primaryContainer` + accent border → `primarySolid`
  (rgb(194,65,12)) fill with the `glass.rim` lit lip = glass orange.
- Knock-outs re-paired for the new fill so they stay legible: selected chip
  becomes `glass.tintStrong` with an orange glyph; the tick's mark becomes
  `onPrimary` with an orange tick; title/sub become `onPrimary` (0.85 on sub).
MEASURED: resting row bg rgba(255,255,255,0.58), border rgba(255,255,255,0.34),
radius 16, height 76, card shadow; selected row bg rgb(194,65,12), border
rgba(255,255,255,0.85). Verified in BOTH themes — in dark the resting row is
rgba(255,255,255,0.10) / 0.14 lip and the selected row stays the same orange.
Tapped Dark then Light to prove the swap; preference left on Light as found.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED (user-directed).

## PASS: section chrome back pill + title pill turned orange glass
User request (user-directed): make the back button and title pill on all
screens orange glass.

SCOPE: `src/components/SectionChrome.tsx` — one shared header, so every section
screen updates together: Home's routed sections (Trip, Trip Tickets, Add Trip,
Add Ticket, Ticket History, Ticket Detail, Passenger, History, Settings,
Advanced, Fare, Terminal, Barangay, the three editors). Not covered:
HomeScreen's own header and BarangayPickerScreen, which has no pill (plain
text header) — neither is a chrome pill.

CORRECTION: both pills keep the `primarySolid` fill and cardShadow and gain a
1px `glass.rim` border — the lit lip that makes a surface read as glass, the
same treatment as the new option rows. 1px on both states so nothing resizes;
the pill sizes are unchanged (44×44 back, 56 title+subtitle, radius 999).
MEASURED: back pill 44×44, title pill 311×56, radius 999, bg rgb(194,65,12),
border rgba(255,255,255,0.85) 1px, card shadow.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean; screenshot verified.
STATUS: CORRECTED (user-directed).

## PASS: the last two non-chrome headers turned orange glass
User request (user-directed, follow-up): the same orange-glass pair on all
screens.

SCOPE: the two headers outside SectionChrome that the previous record listed
as uncovered — `src/screens/BarangayPickerScreen.tsx` (the only hand-rolled
header with a real back control + title) and `src/screens/HomeScreen.tsx`'s
two placeholder nets (`UnbuiltEditor` and the unreachable unknown-section
fallback). Every routed section already goes through SectionChrome; this
closes the file, not the design.

CORRECTION: same recipe, no new component. Solid `primarySolid` fill +
1px `glass.rim` lip + `cardShadow`, radius `full`. Picker: back 48→44 to match
SectionChrome, chevron and title/subtitle ink to explicit white (`onPrimary`
dark ink is a 2.6:1 loser on this orange). Home nets: the icon-only back
became an icon+label pill, the bare `sectionTitle` text gained a `titlePill`
wrapper, sectionBar's `space-between` became `gap: space(3)` so the flexible
pill sits beside the back pill instead of the far edge.
MEASURED (live, Settings): back pill 44×44 radius 999 bg rgb(194,65,12) border
rgba(255,255,255,0.85) 1px; title pill 311×56 same fill/rim. Screenshot
verified. The picker and the two nets are unreachable from the app today, so
they carry no live measurement.
NOTE: `BarangayPickerScreen.tsx` is imported by nothing — a whole dead screen
kept alive only by its own test-free state lib. Worth deleting; out of scope
for a visual pass.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED (user-directed).

## PASS: Settings' four module cards became glass
User request (user-directed): all 4 buttons on the Settings screen must be
glass.

SCOPE: `src/screens/SettingsScreen.tsx` — `makeStyles.card` / `cardAlert` /
`cardPressed`. The four doors were flat opaque panels
(`surfaceContainerLowest` + `outlineVariant` lip, no shadow) while every other
surface on the screen — the chrome pills, the offline note — was glass, so the
middle of the screen read as a different material from both ends.

CORRECTION: same material as the rest of the stack — `glass.tint` fill,
`glass.rimFaint` 1px lip, `cardShadow`. Press deepens to `glass.tintStrong`.
The fare card's alert STATE now repaints only the lip (`palette.error`) and
its value ink; it keeps the glass fill so the four doors stay one stack — a
flat red panel was the one thing that could break the material run again.
MEASURED (live, all four): 367×90, radius `glass`, bg rgba(255,255,255,0.58),
border 1px rgba(255,255,255,0.34), shadow rgba(90,106,130,0.16) 0 8 15.
Screenshot verified. Fare card is not in alert right now (17 fare rows), so
the error-lip branch was read, not measured.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED (user-directed).

## PASS: Fare Configuration cards went glass
User request (user-directed): every white card on the fare screen must be a
glass card.

SCOPE: `src/screens/FareSettingsScreen.tsx` `styles` — `preview`, `card`,
`fxWrap`. Four surfaces were flat `surfaceContainerLowest` with an
`outlineVariant` lip and no shadow: the preview, the three section cards, and
the ten input boxes. On a screen whose chrome, offline footer and glass
backdrop are all one material, the middle was a different substance.
(`glass` + `cardShadow` now imported; the file's static light `palette` is a
known dark-mode divergence — untouched, it belongs to a retheme, not a
material pass.)

CORRECTION: same recipe as Settings' doors — `glass.tint` fill,
`glass.rimFaint` 1px lip, `cardShadow` on preview + card. The input boxes take
`glass.tintStrong` and KEEP their `palette.outline` border: a card can be
subtle, an input needs a harder edge to read as editable, and tint-on-tint
with a soft rim would vanish inside the card.
MEASURED (live, Fare Configuration): preview 367×352, section cards 367×198 /
367×280 / 367×298, storage footer 367×106 — all bg rgba(255,255,255,0.58),
border 1px rgba(255,255,255,0.34), shadow rgba(90,106,130,0.16) 0 8 15.
Screenshot verified.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED (user-directed).

## PASS: Terminal Configuration white cards went glass
User request (user-directed): white cards on the terminal screen become glass.

SCOPE: `src/screens/TerminalConfigScreen.tsx` `styles` — `row`, `rowPressed`,
`caution`, `inlineEmpty`. The five terminal record rows were flat
`surfaceContainerLowest` with an `outlineVariant` lip; the caution notice and
the inline empty-state panel were a hand-rolled `rgba(255,255,255,0.5)` with
the same outline lip. Neither was the app's material, and the rows sat a
section below an already-glass search card.

CORRECTION: all four on the standard recipe — `glass.tint` fill,
`glass.rimFaint` 1px lip, `cardShadow`; press deepens to `glass.tintStrong`.
The two hand-rolled white fills were the exact tint the theme spells, so they
now read tokens instead of literals. Untouched by choice: `pillInactive` /
`pillActive` (chips, not cards) and the `addPill` (the screen's one solid fill
by design).
MEASURED (live, Terminal Configuration): five rows 367×90 — the sixth row
(Caloocan) grows to 109 rather than clipping its two-line value — all bg
rgba(255,255,255,0.58), border 1px rgba(255,255,255,0.34), shadow
rgba(90,106,130,0.16) 0 8 15. Caution/inline-empty carry no live notice right
now, so they were read, not measured. Screenshot verified.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED (user-directed).

## PASS: Advanced Settings "HOW THIS SAVES" got its glass card
User request (user-directed): "this part is missing an holder of glass card" —
the `as-how` block on Advanced Settings floats on the backdrop between two
carded siblings.

SCOPE: `src/screens/AdvancedSettingsScreen.tsx` — `as-how` only.

CORRECTION: `<View testID="as-how">` → `<GlassCard testID="as-how"
style={styles.howCard}>`; new `howCard` = `marginTop space(5)`,
`padding space(5)` (the heading's inline `marginTop` moved onto the card so
the first-child heading sits at the card's own 20, not 40). Heading, list and
rows untouched. Now the screen reads card / card / card: APPEARANCE options,
HOW THIS SAVES, OFFLINE STORAGE — all one material.
MEASURED (live, Advanced Settings): `as-how` 368×281, bg
rgba(255,255,255,0.58), radius 28px. Screenshot verified.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED (user-directed).

## PASS: solid red / orange / yellow — the colours resolve again
User request (user-directed): the alarm and running states had gone translucent
and read as uncoloured. Fault panels were washing out to pink, running cards to
a beige that matched the glass they were supposed to stand out from, and the
accent fill on filled controls stopped being orange at all.

CLASSIFICATION: not a reference defect — the references are solid
(`--error-container`, `--secondary`, `pass-solid { background: var(--secondary)
}` with the rim layers suppressed). The app had drifted off them when the
tint-as-wash idea was applied globally.

SCOPE: 15 files, front-end styles only.
- `src/theme.ts` — `tintedGlass.accent` `rgba(194,65,12,0.9)` → opaque
  `rgb(194, 65, 12)`. At 0.9 over a blurred field the orange never resolved
  and a filled pill looked uncoloured. Only the pigment changed: the card keeps
  the grain, the lit rim and `cardShadow`, so an orange surface still reads as
  this app's material. White over it = 5.2:1, identical light and dark
  (`primarySolid` is the same in both).
- Fault panels → solid `palette.errorContainer` (13 files: AddTicket, AddTrip,
  AdvancedSettings, CurrentTrip, FareSettings, History, Passenger, StatusCard,
  TicketDetail, TicketHistory, TripTickets, Trip, HomeHero). Ink stays
  `onErrorContainer` / `palette.onError`, both of which clear 4.5:1 on
  `#FFDAD6` and `#93000A`.
- Running / active cards → solid `palette.secondary` with the `onAmber` ramp
  (HomeHero `cardRunning`, StatusCard `cardActive`, Trip / TripTickets /
  Passenger `cardRunning`) plus AddTicket's `fareCard` and CurrentTrip's
  `runCard`. `onAmber` is the only ink permitted on `#FFB300` — white is
  1.79:1 and is never used.
- `AddTicketScreen.solidButton` re-filled `palette.primarySolid` (it had been
  left unpainted behind its label).
- Stray row-level accent fills removed — a `<GlassCard tint={tintedGlass.accent}>`
  in `StyleSheet.absoluteFill` placed OUTSIDE its Pressable painted the whole row
  orange and hid the row's own labels. The tint belongs INSIDE the Pressable.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED (user-directed).

## PASS: Barangay Configuration went all glass — error included
User request (user-directed): "in the barangay configuration must be all glass
cards even the buttons and even the error must be red glass".

CLASSIFICATION: DESIGN CHANGE layered on a real inconsistency. The screen
already had glass for the records but kept the other material in eight places,
and the unlinked fault was the loudest of them: `barangay-config.html` paints
`.mod.unlinked` with `--error-container` + a `--error` border, while every
sibling row is a `.glass` surface. The app matched the reference there, and
the user is asking for the screen to be internally consistent instead.

SCOPE: `src/theme.ts`, `src/components/GlassCard.tsx`,
`src/screens/BarangayConfigScreen.tsx`.
- `theme.ts` — added `tintedGlass.error = 'rgb(186, 26, 26)'`, the red
  counterpart of the accent: opaque, `onError` white over it = 6.5:1.
- `GlassCard.tsx` — the forwarded `Pick<ViewProps, …>` gained
  `accessibilityState` and `accessibilityLiveRegion`, which the glass
  Pressables below need to pass through to a real button.
- `BarangayConfigScreen.tsx` — every remaining flat surface became a
  `GlassCard`: `stateError` (now red glass), the `segments` track, the search
  `field`, the scope trigger, `caution`, `noteLock`, `RecordRow` (red glass
  when unlinked), `InlineEmpty` + its ghost button, `PickOption` (orange glass
  when applied), the record sheet's EDIT and DEACTIVATE, `ConfirmSheet`'s
  CANCEL, and the skeleton `skRow`.
- Style cleanup to match: deleted the flat fills and the `outlineVariant` lips
  from `segments`, `field`, `caution`, `row`, `inlineEmpty`, `ghostBtn`,
  `pickRow`, `sheetGhost`, `sheetDestructive`, `skRow`, `stateError`, plus the
  now-dead `rowUnlinked` / `rowPressed` / `pickRowCurrent` / `pickNameCurrent`.
  Ink that was dark for contrast against a white fill is white on the tinted
  rows: `rowTitleUnlinked`, `rowValueUnlinked`, `stateErrorTitle`,
  `stateErrorBody`, `pickNameCurrent`, `pickSubCurrent`.
- Pattern note: a Pressable whose fill is a GlassCard child needs
  `overflow: 'hidden'` + the same `borderRadius` on the Pressable, or the child
  spills one corner. Applied to `field`, `ghostBtn`, `sheetGhost`,
  `sheetDestructive` and the scope trigger.
MEASURED (live, Barangay Configuration):
- unlinked "Subic" row — fill `rgb(186, 26, 26)`, radius 28px, title and value
  ink `rgb(255,255,255)`
- search field — `rgba(255,255,255,0.58)`, radius 16px
- record sheet EDIT — `rgba(255,255,255,0.58)` radius 16px, label
  `rgb(83,67,59)`; DEACTIVATE — `rgb(186, 26, 26)` radius 16px, label white;
  both carry `rgba(90,106,130,0.16) 0 8 15`
- municipality sheet, applied "All Municipalities" — `rgb(194, 65, 12)` radius
  16px, label white; the two unapplied options stay `rgba(255,255,255,0.58)`
  with dark ink
- 14 elements on the screen measure a 28px radius — one material throughout.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED (user-directed).

## PASS: status caption — smaller, and centred
User request (user-directed): "reduce the font size and make it to the middle or
center" on the `Status filter: ALL, applied to both lists. Change` row.

CLASSIFICATION: DESIGN CHANGE, not a reference defect. `barangay-config.html`
and `terminal-config.html` both set this caption as a left-aligned inline
sentence at 12px with a `label-l` action — the app already matched that. But
the action was the one thing on the row set above the sentence: the sentence is
`bodySmall` 12px and "Change" was `labelLarge` 15px, so the control shouted
over the status it was qualifying and the row read as a left-aligned toolbar
rather than a caption.

SCOPE: `src/screens/BarangayConfigScreen.tsx`, `src/screens/TerminalConfigScreen.tsx`
— `caption` and `textActionLabel` in each. The two screens are a pair built from
the same shape, so both moved; leaving one at 15px would have made the pair
differ in type size for no reason.
CORRECTION:
- `caption` gains `justifyContent: 'center'`. The dot and the action keep
  their own `flexShrink` rules, so a long status value still wraps the
  sentence rather than pushing the action off the row.
- `textActionLabel` `type.labelLarge` (15/20) → `type.bodySmall` with
  `Poppins_600SemiBold` (12/18). Still unmistakably a control through weight
  and the accent ink, no longer a different size from the sentence beside it.
  The Pressable keeps its 48px `minHeight`, so the touch target never shrinks
  with the label.
MEASURED (live, Barangay Configuration, 407px viewport): `justify-content`
`center`; row 367px wide with the three children at offsets 35 / 48 / 275
(5 / 219 / 57) — 35px gutter left, 35px right. "Change" 12px
`Poppins_600SemiBold`; the sentence 12px `Poppins_400Regular`, so the row is
one size throughout.
NOTE: `preview_screenshot` returned frames for this row that read as
left-aligned, which contradicted the rects. Re-checked by hit-testing the
rendered surface: `elementFromPoint(55, ·)` returns the 5px dot and
`elementFromPoint(25/40/70, ·)` does not, so the dot really is at x=55 and the
row really is centred. The screenshots were not stale; the thumbnails were
just read wrong. Numbers above are the authoritative ones.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED (user-directed).

## PASS: Add Ticket — recent rows lost their gutter, footer lost its glass
User report (two defects, one screen): "recent ticket cards in the add ticket
the left and right spacing are not applied then the local storage card at the
bottom the glass is missing".

CLASSIFICATION: BOTH ACTUAL DEFECTS. `add-ticket.html` is explicit on both.

1. The gutter. `#recentList` is `.list { display: grid; gap: 12px }` and has no
   margin of its own — it inherits its 20px insets from the `.readable` column
   that wraps every section (`.readable { padding-inline: 20px }`). The app's
   `column` is unpadded and each block carries its own `marginHorizontal`, so
   the app's `recentList` had `marginTop: space(3)` and nothing else. The four
   recorded tickets ran the full 367px while every other card on the screen sat
   20px in from both edges, so the RECENT TICKETS section was the one block
   that broke the page's left and right alignment. The 12px between rows was
   already right (`recentRow.marginBottom`), and the empty state was already
   right (it used `styles.gutter`) — only the populated list was wrong.

2. The footer. `add-ticket.html:746` is
   `<div class="glass storage" data-od-id="storage-footer">` — a glass card
   holding a bare 18px database glyph and one sentence. The app rendered the
   same sentence as a `<Text>` inside a plain `<View style={styles.gutter}>`,
   so the screen closed on unframed text with no icon at all. The card, the
   glyph and the padding were all missing.
SCOPE: `src/screens/AddTicketScreen.tsx` and `src/screens/AddTripScreen.tsx`.
Add Trip was not named, but `add-trip.html:724` is the same
`<div class="glass storage" data-od-id="storage-footer">` with the same `.storage`
rule, and `AddTripScreen` was carrying the identical bare `<Text>` in the
identical wrapper — a known second instance of a defect already found, so it
moved with the first.
CORRECTION:
- `recentList` gains `marginHorizontal: space(5)`. Nothing else moved.
- Both footers: `<View style={styles.gutter}><Text …/></View>` →
  `<GlassCard testID="storage-footer" style={styles.storageCard}>` holding
  `<Icon name="database" size={18} color={glass.accentTertiary} />` and the
  existing sentence. `storageCard` is the reference's
  `.storage { margin-top: 20px; padding: 12px 20px; display: flex; align-items: center; gap: 8px }`;
  `storageNote` drops its `marginTop` (the card owns the space now) and gains
  `flex: 1`. `glass` added to each file's theme import.
- Not extracted into a component: two call sites, and `LocalStorageCard` is a
  different shape (tinted icon chip + a label line) while the reference's
  `.storage` is a bare glyph and one paragraph. Extract if a third appears.
MEASURED (live, Add Ticket, 407px viewport):
- the four RECENT TICKETS rows — x=20, w=367, fill `rgba(255,255,255,0.58)`
- `storage-footer` — 367×78 at x=20, bg `rgba(255,255,255,0.58)`,
  border-radius 28px, padding `12px 20px`, `display: flex`, `align-items: center`,
  `gap: 8px`, shadow `rgba(90,106,130,0.16) 0 8 15`; the 18px glyph sits
  before the sentence, 8px in from the card's 20px padding
NOT VERIFIED LIVE: Add Trip's footer. Reaching `AddTripScreen` needs no trip
running (`onAddTrip` hangs off `IdleTripCard` / `EmptyTripCard`), and ending
trip #6 to get there would write to the store — out of scope for a
front-end pass. The change is the same six lines as the verified one, and
`npx tsc --noEmit` / `npx expo lint` are clean.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED.

## PASS: Current Trip running card went solid amber like Home's
User request (user-directed): "this card make it into solid yellow like in the
homescreen" — pointing at `data-testid="ct-run-card"`.

CLASSIFICATION: DESIGN CHANGE. The card was already solid amber-ISH: it wore the
PALE `palette.secondaryContainer` (#FFEFC7) behind a `amberSurface.border`.
Home's running card (`HomeHero.cardRunning`) is the full `palette.secondary`
(#FFB300), borderless, with `cardShadow`. So the two screens disagreed on what
"solid amber" means — and the disagreement was load-bearing, because everything
inside this card had been tuned for the pale fill.

SCOPE: `src/screens/CurrentTripScreen.tsx`, `runCard` and everything painted on
it. No other screen touched — the Home card was already correct and became the
model.
CORRECTION:
- `runCard`: `backgroundColor` `secondaryContainer` → `palette.secondary`;
  `borderWidth`/`borderColor` deleted (Home's card has no border); `cardShadow`
  added so it sits at the same depth as every panel on the screen.
- Every ink re-pointed to the `onAmber` ramp, which is the only permitted ink
  on a solid amber surface. Left behind: `palette.onSecondaryContainer`
  (#4A3600) on the keys, labels, legend and note, and `palette.onSecondary` on
  the values. They read on #FFEFC7; on #FFB300 the ramp is what was drawn for
  it. Inks are now `onAmber.primary` #3D2E00 on `runFigValue`, `runRowValue`,
  the route and `statusPillText`, and `onAmber.muted` #5B4720 on every key,
  label, the legend and the note. Nothing on the card is off-ramp.
- `runRow.borderBottomColor` `amberSurface.rule` (#E0C489) → `rgba(61,46,0,0.25)`.
  `amberSurface.rule` is a tone of the PALE container and vanishes on the full
  amber; the Home card's own `figuresRunning` rule uses exactly this value.
- Unchanged on purpose: `statusPill` keeps its `rgba(255,255,255,0.55)` chip
  (light ground, #3D2E00 ink — high contrast on either fill), the `mixTrack`
  `rgba(61,46,0,0.10)` trough, and the three dark mix fills (`primarySolid`,
  `tertiary`, `onAmber.detail`). The comment on `mixSenior` was updated: it
  justified `onAmber.detail` against a "secondaryContainer fill" that no longer
  exists, but the reason still holds (amber on this fill is ~1.1:1).
MEASURED (live, Current Trip, 407px viewport): card 367×491 at x=20, bg
`rgb(255, 179, 0)`, border 0px, radius 28px, shadow
`rgba(90,106,130,0.16) 0 8 15`. Ink census across the card — values, route and
RUNNING `rgb(61, 46, 0)`; keys, PASSENGERS/COLLECTED labels, legend and note
`rgb(91, 71, 32)`; no other colour present. Rules `rgba(61,46,0,0.25)`. Pill
87×22 `rgba(255,255,255,0.55)` radius 999 with a #3D2E00 dot. Mix fills
`rgb(194,65,12)` / `rgb(84,110,122)` / `rgb(79,61,43)`. Screenshot verified.
REGRESSION: `npx tsc --noEmit`, `npx expo lint` clean.
STATUS: CORRECTED (user-directed).
NOTE: `amberSurface` is now referenced nowhere in `src/` — this card was its
last consumer. Left in `theme.ts` as a documented token rather than deleted in
a design pass; remove it separately if nothing adopts it.

## PASS: Trip Tickets gate card lost its 20px side gutters

`TripTicketsScreen`'s `GateNote` rendered edge to edge while every other block on
the screen stayed inset. Measured before the fix: the glass card was x=0, w=407
— the full viewport — directly under a trip card at x=20, w=367.

Cause: the reference puts `.gate` inside `.container { padding: 0 20px }`
(trip-tickets.html:212), so its gutter is supplied by the container. The app's
list `column` is unpadded and `TripCard` wraps itself in `styles.gutter`
(`marginHorizontal: space(5)`), but `GateNote` passed `styles.gate` straight to
`GlassCard` with no horizontal margin at all. Every other block on the screen
carries its own gutter, so the gate was the one omission.

Fix — `styles.gate` gains `marginHorizontal: space(5)`, matching the reference
container's inline padding. Padding stays `space(4)`; the reference's
`padding: 16px 20px` is a vertical 16 plus the container's horizontal 20.

Verified live on trip #5 (completed, so the gate renders): x=20, w=367,
`margin: 0px 20px`, padding 16px, bg `rgba(255,255,255,0.58)` — identical
geometry to the trip card above it. `npx tsc --noEmit` and `npx expo lint` both
clean.

## PASS: Trip Tickets trip card rendered bare when completed

The card at the top of Trip Tickets had no shell at all on a completed trip.
Measured before the fix: x=20 y=92 w=368 h=280, background `rgba(0, 0, 0, 0)`,
no radius, no shadow — bare text sitting on the `#F4F7FB` backdrop, while the
gate, every ledger row and the storage card below it all wore glass.

Cause: `styles.card` was `{ padding: space(5) }` and nothing else. The card's
fill came entirely from `running && styles.cardRunning`, so the moment a trip
ended there was no shell left. The reference never has this state —
`tripCardHtml` returns `class="glass hero ${running ? 'hero-solid' : 'hero-glass'}"`
(trip-tickets.html:1059), i.e. glass in both branches, solid amber only as an
override.

Fix — one tree, two shells: `const Card = running ? View : GlassCard;` and the
card element renders `<Card style={[styles.card, running && styles.cardRunning]}>`.
`GlassCard` supplies the `rgba(255,255,255,0.58)` tint, the 1px rim, the 28px
corner and `cardShadow`, which is exactly the reference's `.glass` block
(trip-tickets.html:226). A running trip keeps the plain `View` so its solid
amber is not washed to pastel by a translucent tint over a blur. The
`running &&` text/pill/figures overrides inside are unchanged.

`LoadingTripCard` had the same omission — the reference's `loadingCardHtml` is
`glass hero hero-glass` too — so it also swapped its bare `View` for
`GlassCard`.

Verified live on trip #5 (completed): card x=20 y=92 w=367 h=280, background
`rgba(255,255,255,0.58)`, radius 28px, shadow `rgba(90,106,130,0.16) 0 8 15`,
inner rim `rgba(120,130,150,0.5)` — same geometry and fill as the gate directly
below it. Trip #6 (running) path untouched. `npx tsc --noEmit` and
`npx expo lint` both clean.

## PASS: Advanced Settings selected option's corners overran the option row

The chosen mode option wore a taller radius than the row it sits on. Measured
before the fix: option `rad 16px` with `overflow: visible`, its orange tint
child `rad 28px` at x=21 y=129 w=366 h=74 — so the solid `rgb(194,65,12)` fill
pushed its corners past the glass row's own 16px corner on all four sides. The
unselected option underneath has no fill, so the two looked like different
shapes rather than one selected state.

Cause: the `tintedGlass.accent` GlassCard was passed `cornerRadius={radius.glass}`
(28) inside a Pressable whose `styles.option` is `radius.large` (16). GlassCard
defaults to 28, so the default won.

Fix — `cornerRadius={radius.glass}` → `cornerRadius={radius.large}` on the
overlay, and `overflow: 'hidden'` added to `styles.option` so anything filled
in there is clipped to the row's own corner rather than escaping it.

Verified live: option x=20 y=128 w=367 h=76, `rad 16px`, `overflow hidden`;
fill x=21 y=129 w=365 h=74, `rad 16px`, `rgb(194, 65, 12)`. Both rows now read
as the same shape with one filled in. `npx tsc --noEmit` and `npx expo lint`
both clean.

## PASS: White lit edge showed as a border line on every orange pill

Every tinted card — the orange pills across History, Period Control, Home quick
actions, Add Ticket, Add Trip, Current Trip, Fare, Barangay, Terminal,
Advanced Settings — carried a 1px `rgba(255,255,255,0.85)` inner ring on top of
its own fill. Against the amber and orange solid fills that read as a white
border around the pill, not as a lit edge on glass.

Cause: `GlassCard.styles.innerRim` always painted `borderColor: glass.rim`. The
reference keeps that ring only while the panel is glass and removes it the
moment the panel has a fill of its own:
`.glass.fare-solid::after { display: none }` (add-ticket.html:544) and
`.glass.status-solid::after { display: none }` (add-ticket.html:240). The app
had no equivalent branch.

Fix — one place, all screens. `GlassCard` now picks the edge colour:
`borderColor: tint ? 'transparent' : rim ?? glass.rim`. `borderColor` removed
from `styles.innerRim` so there is a single source for it.

Verified live: tinted orange pill at x=40 y=368 327x48, its rim layer
`1px rgba(0,0,0,0)` — no white line. Untinted glass still
`1px rgba(255,255,255,0.85)` on ROUTE / ROAD / PASSENGERS / ledger rows. On
Add Ticket, 0 white rims left on the orange surfaces. `npx tsc --noEmit` and
`npx expo lint` both clean.

## PASS: Storage note had no card and no left/right space in the record editors

Two defects on the same footer. Measured before the fix, `ab-storage` on the
Edit Barangay screen: `rect [20,502,367,78]`, `bg rgba(0,0,0,0)`,
`rad 0px`, `padding 20px 8px`, `gap 8px` — a bare row sitting on the
backdrop. Every other storage footer in the app is a GlassCard at
`rgba(255,255,255,0.58)` / radius 28, so this one read as loose text next to
a card on every neighbouring screen. Its 8px horizontal padding was also the
tightest of any footer: the reference's own `.glass.storage` is
`padding: 12px 20px` (add-ticket.html:746) and every other card in the app
carries 20px.

Cause — the three record editors were never converted when the rest of the app
went to glass. `BarangayEditor`, `MunicipalityEditor` and
`TerminalEditorScreen` built the note as a plain `<View testID="…-storage">`,
while `BarangayConfigScreen`, `AdvancedSettingsScreen`, `FareSettingsScreen`,
`SettingsScreen`, `TerminalConfigScreen` and `CurrentTripScreen` already pass
it a `GlassCard`.

Fix:
- `<View>` → `<GlassCard>` on `ab-storage`, `am-storage`, `tc-storage`. Icon
  16 → 18, the size every other storage note uses.
- `noteLock` in all four of those files plus `BarangayConfigScreen`:
  `paddingHorizontal` `space(2)` → `space(5)`, `paddingVertical`
  `space(5)` → `space(4)`, `gap` `space(2)` → `space(3)` — the recipe
  `LocalStorageCard` and `StorageNote` already share. The 20px gutter itself
  was never the problem: all five columns are `paddingHorizontal: space(5)`.

Verified live on Edit Barangay: `rect [20,502,367,88]`,
`bg rgba(255,255,255,0.58)`, `rad 28px`, `padding 16px 20px`, `gap 12px`,
`m 20px 0 0`, shadow `rgba(90,106,130,0.16) 0 8 15`. `npx tsc --noEmit` and
`npx expo lint` both clean. Municipality Editor and Terminal Editor carry the
identical edit but were not opened live (both sheets write on save).

## PASS: Passenger filter's active chip was pure white instead of accent glass

The chosen filter chip wore `glass.tintStrong` (`rgba(255,255,255,0.72)`) with
`borderColor: glass.rim` — so the active state read as a plain white pill with
a white lip, next to four transparent ones. Reference `passenger.html:540`
gives the selected chip `background: var(--primary-container)` with
`border-color: var(--primary-solid)`; the app's own accent treatment for every
other filled pill is `tintedGlass.accent`.

Fix, on `PassengerScreen`:
- Selected chip renders `<GlassCard tint={tintedGlass.accent}
  cornerRadius={radius.full} style={StyleSheet.absoluteFill}
  pointerEvents="none" />` inside the Pressable — the established fill-under-
  content pattern. Its rim is already dropped by GlassCard's `tint` branch, so
  there is no white line to remove.
- `styles.chip` += `overflow: 'hidden'`, so the 999px fill is clipped to the
  63×44 pill instead of spilling its 28px default corner.
- `chipSelected`: `backgroundColor glass.tintStrong` + `borderColor glass.rim`
  → `borderColor: palette.primarySolid` (fill-coloured, invisible edge).
- `chipLabelSelected`: `palette.onSurface` → `#FFFFFF` — 5.2:1 on #C2410C, the
  same ink `SectionChrome` documents for its accent pills.
- `glass` dropped from the file's theme import (now unused).

Verified live on Passengers: "All" chip `rect [30,499,63,44]`,
`border rgb(194,65,12)`, fill `rgb(194,65,12)` at `999px` clipped to
`[31,500,61,42]`, rim layer `1px rgba(0,0,0,0)`, label `rgb(255,255,255)`
`Poppins_600SemiBold` 11/16. The four unselected chips stay transparent with
`rgb(133,115,107)` outlines. `npx tsc --noEmit` and `npx expo lint` both clean.

## PASS: Trip Tickets trip card sat too close to the chrome

The trip card sat 12px under the title pill and read as touching it. The
reference hands that gap over from the chrome rather than from the card:
`.chrome { margin: 8px 0 var(--section-margin) }`
(trip-tickets.html:266) with `--section-margin: 20px` (line 161), so the card
also inherits it when the slot is empty.

Fix — `TripTicketsScreen.styles.gutter.marginTop` `space(3)` → `space(5)`.
`gutter` wraps all six top-level blocks on the screen (trip card, loading
card, error card, gate, ledger empty, closed-trip card), so the single line
sets the whole column's top rhythm.

Verified live: chrome bottom `80`, card top `100`, gap `20px`; card
`[20,100,367,344]` still solid amber `rgb(255,179,0)`,
`wrapMargin 20px 20px 0px`. `npx tsc --noEmit` and `npx expo lint` both clean.

## PASS: Home copied home.html's tiles and every card frosted (user-directed)

User request (user-directed): read home.html, copy its design into the real
Home screen, and make sure the white cards are glass.

SCOPE:
- `src/theme.ts` — added `glassBlur = 18`, the reference's
  `backdrop-filter: blur(18px) saturate(180%)` (home.html `.glass`). At
  `intensity: 0` the BlurView sampled nothing and every panel read as a flat
  white wash — the tint with no refraction — which is what made the cards
  look white rather than glass. `saturate` has no RN primitive.
- `src/components/QuickActionsGrid.tsx` — the tile is now the reference's
  `.qa-btn`: chip 40px (was 48), corner 16 (`.qa-btn` overrides `.glass`'s
  28), min height 112 (was 152), no chevron, and the live figure the
  reference prints under the title (`₱753.36 today`, `3 trips on file`,
  `Trip #6 running`) instead of the static blurb, which moves into the
  accessible name exactly as the reference builds it:
  `"<title>. <blurb>. <value>. <extra>. Opens <screen>."` — `value`, `extra`
  and `opens` were already computed on the screen and never rendered.
  Primary chip ink `#E65100` → `primarySolid` per the reference's
  `tone-primary`. Dropped `compact`/`NARROW_WIDTH`: one ellipsised line has
  nothing to grow for.
- `src/screens/HomeScreen.tsx` — tile order copied from the reference
  (Dashboard, History, Trips, Tickets, Passengers, Settings) with the app's
  Current Trip kept after Trips; the section-net card (the last opaque
  `surfaceContainerLow` fill in the file) became `GlassCard` at `glassBlur`
  with glass ink.
- `src/components/home/HomeHero.tsx` — frost 18; `.hero-error`'s reference
  rule `border: none` honoured (the red outline round the card was the
  app's own); the ghost button's amber `onSecondary` border override
  dropped — the reference keeps `--outline` there.
- `src/components/home/LastTripCard.tsx`, `StorageNote.tsx` — frost 18;
  the link reads `View all in History` (home.html:930), chevron dropped.

NOT CHANGED: the idle hero keeps its three day figures where the reference
shows none (the app's addition; the separate LAST TRIP card matches the
reference); tile nouns stay `ticket` where the reference says `fare` —
app-wide data vocabulary.

Verified live on web: running and idle snapshots — tiles print the live
figures, a11y names carry blurb/value/extra/opens, LAST TRIP link reads
"View all in History", every home card refracts the field (no white fills
remain). `npx tsc --noEmit` clean; `npx expo lint` 0 errors (3 pre-existing
warnings in untouched lines).
