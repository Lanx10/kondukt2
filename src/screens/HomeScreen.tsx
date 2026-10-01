import * as _react from 'react';
import * as _reactNative from 'react-native';
import * as _reactNativeSafeAreaContext from 'react-native-safe-area-context';
import * as _componentsHomeHeader from '../components/HomeHeader';
import * as _componentsHomeHomeHero from '../components/home/HomeHero';
import * as _componentsHomeLastTripCard from '../components/home/LastTripCard';
import * as _componentsGlassBackdrop from '../components/GlassBackdrop';
import * as _componentsGlassCard from '../components/GlassCard';
import * as _componentsStorageNote from '../components/StorageNote';
import * as _componentsQuickActionsGrid from '../components/QuickActionsGrid';
import * as _DashboardScreen from './DashboardScreen';
import * as _TripTicketsScreen from './TripTicketsScreen';
import * as _TripScreen from './TripScreen';
import * as _AddTripScreen from './AddTripScreen';
import * as _AddTicketScreen from './AddTicketScreen';
import * as _PassengerScreen from './PassengerScreen';
import * as _CurrentTripScreen from './CurrentTripScreen';
import * as _HistoryScreen from './HistoryScreen';
import * as _TicketHistoryScreen from './TicketHistoryScreen';
import * as _TicketDetailScreen from './TicketDetailScreen';
import * as _FareSettingsScreen from './FareSettingsScreen';
import * as _TerminalConfigScreen from './TerminalConfigScreen';
import * as _TerminalEditorScreen from './TerminalEditorScreen';
import * as _BarangayConfigScreen from './BarangayConfigScreen';
import * as _BarangayEditor from './BarangayEditor';
import * as _MunicipalityEditor from './MunicipalityEditor';
import * as _SettingsScreen from './SettingsScreen';
import * as _AdvancedSettingsScreen from './AdvancedSettingsScreen';
import * as _dataTripTicketsStore from '../data/tripTicketsStore';
import * as _libUseHomeSnapshot from '../lib/useHomeSnapshot';
import * as _libUseNow from '../lib/useNow';
import * as _libTripScreenFormat from '../lib/tripScreenFormat';
import * as _libTripTicketsFormat from '../lib/tripTicketsFormat';
import * as _libHistoryState from '../lib/historyState';
import * as _icons from '../icons';
import * as _theme from '../theme';
import * as _reactJsxRuntime from 'react/jsx-runtime';

 "use strict";



 /** Shown in place of a figure that has no meaning yet. */
 let EMPTY_VALUE = '—';
 let SECTIONS = {
   dashboard: {
     key: 'dashboard',
     title: 'Dashboard',
     subtitle: 'Earnings and summary',
     icon: 'grid'
   },
   tickets: {
     key: 'tickets',
     title: 'Tickets',
     subtitle: 'Manage and view tickets',
     icon: 'ticket'
   },
   trip: {
     key: 'trip',
     title: 'Trip',
     subtitle: 'Start and manage trips',
     icon: 'bus'
   },
   passenger: {
     key: 'passenger',
     title: 'Passenger',
     subtitle: 'View passenger data',
     icon: 'person'
   },
   history: {
     key: 'history',
     title: 'History',
     subtitle: 'Past trips and records',
     icon: 'history'
   },
   settings: {
     key: 'settings',
     title: 'Settings',
     subtitle: 'Configure fares and terminals',
     icon: 'settings'
   },
   // The three Settings sub-modules. Each one has a real screen now; these
   // entries carry the title and icon the section chrome shows, and the
   // `if (section)` net at the foot of the router is the only thing still
   // reading them.
   fare: {
     key: 'fare',
     title: 'Fare Configuration',
     subtitle: 'Manage fares and discounts',
     icon: 'fare'
   },
   terminal: {
     key: 'terminal',
     title: 'Terminal Configuration',
     subtitle: 'Manage terminals and KM markers',
     icon: 'terminal'
   },
   barangay: {
     key: 'barangay',
     title: 'Barangay Configuration',
     subtitle: 'Manage barangays and KM markers',
     icon: 'barangay'
   }
 };
/** Routes that have a full screen of their own, beyond the section cards. */
type OpenRoute =
  | 'tickets'
  | 'ticketHistory'
  | 'ticketsReadOnly'
  | 'ticketDetail'
  | 'addTicket'
  | 'addTrip'
  | 'currentTrip'
  | 'advanced'
  | 'terminalEditor'
  | 'barangayEditor'
  | 'municipalityEditor';

/** Every route this screen owns; `null` is Home itself. */
type SectionKey = keyof typeof SECTIONS | OpenRoute;

 function HomeScreen() {
   let insets = (0, _reactNativeSafeAreaContext.useSafeAreaInsets)();
   let now = (0, _libUseNow.useNow)();
   let [open, setOpen] = _react.useState<SectionKey | null>(null);
   // Non-null only while the Tickets section is open. The screen takes the
   // active trip's numeric id — the SQLite store keys trips by integer, and
   // the section router's string keys are UI state, not record ids.
   let [tripId, setTripId] = _react.useState<number | null>(null);
   // Non-null only while ticket detail is open. Ticket detail is (trip,
   // ticket) — both ids, never one inferred from the other.
   let [ticketId, setTicketId] = _react.useState<number | null>(null);
   // Which ledger the open ticket was opened from. Both are the same screen
   // with different recording rights, so only the opener tells them apart —
   // and back has to return to the one the driver came from.
   let [ticketDetailBack, setTicketDetailBack] = _react.useState<'tickets' | 'ticketHistory' | 'ticketsReadOnly'>('ticketHistory');
   // Held for the terminal editor (separate prompt). Null = create mode.
   let [terminalEditorId, setTerminalEditorId] = _react.useState<number | null>(null);
   // Held for the two location editors, each a separate prompt. Null = create
   // mode; the id is set by the Barangay Configuration screen's add/edit
   // actions, exactly like the terminal editor's.
   let [barangayEditorId, setBarangayEditorId] = _react.useState<number | null>(null);
   let [municipalityEditorId, setMunicipalityEditorId] = _react.useState<number | null>(null);
   // The one-shot trip-ended signal: set by Current Trip, shown once by
   // History, cleared when History closes so it can never replay.
   let [tripEndedMessage, setTripEndedMessage] = _react.useState<string | null>(null);
   let startTrip = (0, _react.useCallback)(() => setOpen('trip'), []);

   /**
    * The Android hardware back press, routed to the screen's parent.
    *
    * This app's navigation is a state machine in this component — there is no
    * navigator to own a back stack — so with no handler registered the system's
    * default applied: back **closed the app** from Settings, from a form, from
    * anywhere but Home. The user's mental model on Android is that back moves up
    * one level, and losing a half-filled form to an app exit is the kind of
    * behaviour that reads as a crash.
    *
    * The mapping is the parent of whatever is open, with two exceptions that are
    * not parents but origins: ticket detail returns to whichever ledger opened it
    * (`ticketDetailBack`), and a ticket form returns to the trip's ledger when a
    * trip id is held. Returning `false` on Home hands the press back to the OS,
    * which is what closes the app — the one place that is correct.
    */
   let handleHardwareBack = (0, _react.useCallback)(() => {
     switch (open) {
       case null:
         return false;
       case 'addTrip':
         setOpen('trip');
         return true;
       case 'tickets':
         setTripId(null);
         setOpen(null);
         return true;
       case 'history':
         setTripEndedMessage(null);
         setOpen(null);
         return true;
       case 'ticketHistory':
         setOpen('tickets');
         return true;
       case 'ticketsReadOnly':
         setOpen('history');
         return true;
       case 'ticketDetail':
         setOpen(ticketDetailBack);
         return true;
       case 'addTicket':
         setOpen(tripId === null ? null : 'tickets');
         return true;
       case 'advanced':
       case 'fare':
       case 'terminal':
       case 'barangay':
         setOpen('settings');
         return true;
       case 'terminalEditor':
         setOpen('terminal');
         return true;
       case 'barangayEditor':
       case 'municipalityEditor':
         setOpen('barangay');
         return true;
       default:
         // dashboard, trip, currentTrip, passenger and the section net: all one
         // level under Home.
         setOpen(null);
         return true;
     }
   }, [open, ticketDetailBack, tripId]);
   (0, _react.useEffect)(() => {
     let subscription = _reactNative.BackHandler.addEventListener('hardwareBackPress', handleHardwareBack);
     return () => subscription.remove();
   }, [handleHardwareBack]);

   // The Tickets tile and the hero's "record a fare" both resolve their trip from
   // the store: the running one when there is a trip, else the latest on file.
   // With no trips at all there is nothing to show, so the action is inert rather
   // than opening a screen built around a missing id.
   let openDefaultTickets = (0, _react.useCallback)(() => {
     void (0, _dataTripTicketsStore.fetchDefaultTripId)().then(id => {
       if (id !== null) {
         setTripId(id);
         setOpen('tickets');
       }
     });
   }, []);

   // Recording a fare needs a *running* trip, so this resolves an ACTIVE id only
   // — never `fetchDefaultTripId`, which falls back to the most recent finished
   // trip. That fallback put a boarding on a trip that had already been stamped
   // ended: the figures on History would change under a closed run.
   //
   // It opens the record screen itself rather than the tickets list. The action
   // is called RECORD A FARE, and the list is a hop between the press and the
   // thing being pressed for; the list's own "Record" button is still there for
   // anyone who lands on it from a trip.
   let openActiveTickets = (0, _react.useCallback)(() => {
     void (0, _dataTripTicketsStore.fetchActiveTripId)().then((id: any) => {
       if (id !== null) {
         setTripId(id);
         setOpen('addTicket');
       } else {
         // Nothing is running, so there is nothing to charge. Send the conductor
         // to the one screen that starts a trip rather than to a fare form with
         // no trip behind it.
         setOpen('trip');
       }
     });
   }, []);

   // Everything the hero and the tiles report, in one read that repaints on
   // every store write. The router above never touches it; only the home view
   // does, and only when no section is open.
   let snapshot = (0, _libUseHomeSnapshot.useHomeSnapshot)();
   let today = snapshot.today;
   let dash = EMPTY_VALUE;
   // "Nothing on this device" has to mean nothing AND nothing running.
   //
   // It used to be `totals.tripCount === 0` alone, and that is a contradiction
   // waiting to happen: tripCount is an all-time history figure read by a
   // different query from the running trip, so the moment one of the two
   // disagreed the tagline said "Nothing recorded yet" directly under a hero
   // saying TRIP IN PROGRESS. An active trip IS a trip on file, so it can never
   // make this screen empty.
   let empty = snapshot.activeTrip === null && snapshot.totals.tripCount === 0 && snapshot.status !== 'loading';

   // The five mutually exclusive taglines. Which one is true *is* the state the
   // user came to check, so a fixed subtitle would say nothing.
   let tagline = snapshot.status === 'loading' ? 'Reading records' : snapshot.status === 'error' ? 'Records could not be read' : snapshot.activeTrip ? 'Fares are being recorded' : empty ? 'Nothing recorded yet' : 'Ready when you are';

   // The reference's compact "1h 18m" — a pill and a hero line are glances,
   // not a stopwatch; HH:MM:SS belongs to the Trip screen's ELAPSED metric.
   let tripPill = snapshot.activeTrip ? `#${snapshot.activeTrip.trip_number} · ${(0, _libTripScreenFormat.formatDurationShort)(now.getTime() - snapshot.activeTrip.startedAt)}` : null;
   let showLastTrip = snapshot.status === 'ready' && !snapshot.activeTrip && snapshot.lastCompleted !== null;
   let hero = (() => {
     if (snapshot.status === 'loading') {
       return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsHomeHomeHero.HomeHero, {
         state: "loading",
         eyebrow: "",
         title: "",
         body: "",
         actions: []
       });
     }
     if (snapshot.status === 'error') {
       return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsHomeHomeHero.HomeHero, {
         state: "error",
         eyebrow: "RECORDS UNAVAILABLE",
         title: "Could not read the saved records",
         body: "Nothing was lost. The trip and ticket records are still on this device, and reading them again is safe.",
         actions: [{
           label: 'Read records again',
           onPress: () => setOpen(null)
         }]
       });
     }
     if (snapshot.activeTrip) {
       return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsHomeHomeHero.HomeHero, {
         state: "running",
         eyebrow: "TRIP IN PROGRESS",
         eyebrowChip: `TRIP #${snapshot.activeTrip.trip_number}`,
         title: snapshot.activeTrip.origin,
         titleSuffix: `→ ${snapshot.activeTrip.destination}`,
         when: `Started ${(0, _libTripScreenFormat.formatShortTime)(snapshot.activeTrip.startedAt)} · ${(0, _libTripScreenFormat.formatDurationShort)(now.getTime() - snapshot.activeTrip.startedAt)} running`,
         body: "",
         figures: [{
           value: (0, _libTripTicketsFormat.centavos)(today.earnings),
           label: 'COLLECTED TODAY'
         }, {
           value: String(today.ticketCount),
           label: 'TICKETS TODAY'
         }, {
           value: String(today.passengerCount),
           label: 'PASSENGERS'
         }],
         actions: [{
           icon: 'ticket',
           label: 'Record a fare',
           onPress: openActiveTickets
         }, {
           label: 'Trip details',
           onPress: () => setOpen('currentTrip')
         }]
       });
     }
     if (empty) {
       return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsHomeHomeHero.HomeHero, {
         state: "empty",
         eyebrow: "NO TRIPS RECORDED",
         title: "Start the first trip",
         body: "Fares can only be recorded while a trip runs. Start one and the figures on this screen will fill in as the day goes.",
         actions: [{
           label: 'Start trip',
           onPress: startTrip
         }]
       });
     }
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsHomeHomeHero.HomeHero, {
       state: "idle",
       eyebrow: "NO ACTIVE TRIP",
       title: "Ready for the next run",
       body: "Fares can only be recorded while a trip runs. Start the next trip and the ticket flow takes over from here.",
       figures: [{
         value: (0, _libTripTicketsFormat.centavos)(today.earnings),
         label: 'COLLECTED TODAY'
       }, {
         value: String(today.ticketCount),
         label: 'TICKETS TODAY'
       }, {
         value: String(today.passengerCount),
         label: 'PASSENGERS'
       }],
       actions: [{
         label: 'Start trip',
         onPress: startTrip
       }]
     });
   })();
   let actions = [{
     key: 'dashboard',
     icon: 'grid',
     title: 'Dashboard',
     subtitle: 'Earnings and today’s summary',
     accent: 'primary',
     opens: 'Dashboard',
     value: empty ? `${dash} today` : `${(0, _libTripTicketsFormat.centavos)(today.earnings)} today`,
     extra: empty ? 'Nothing recorded yet' : `${(0, _libHistoryState.plural)(today.tripCount, 'trip')} today · ${(0, _libHistoryState.plural)(today.ticketCount, 'ticket')}`,
    onPress: () => setOpen('dashboard')
  },
  {
    key: 'history',
    icon: 'history',
    title: 'History',
    subtitle: 'Past trips and records',
    accent: 'tertiary',
    opens: 'History',
    value: empty ? 'No trips on file' : `${(0, _libHistoryState.plural)(snapshot.totals.tripCount, 'trip')} on file`,
    extra: empty ? 'Nothing recorded yet' : `Yesterday collected ${(0, _libTripTicketsFormat.centavos)(snapshot.yesterdayEarnings)}`,
    onPress: () => setOpen('history')
  }, {
    key: 'trip',
     icon: 'bus',
     title: 'Trips',
     subtitle: 'Start and manage trips',
     accent: 'primary',
     opens: 'Trip management',
     value: snapshot.activeTrip ? `Trip #${snapshot.activeTrip.trip_number} running` : empty ? 'No trips yet' : `${(0, _libHistoryState.plural)(today.tripCount, 'trip')} today`,
     extra: snapshot.activeTrip ? `Started ${(0, _libTripScreenFormat.formatShortTime)(snapshot.activeTrip.startedAt)}` : 'Ending a trip lives in trip management',
     onPress: () => setOpen('trip')
   },
   // The live operational screen: derives the active trip from the store,
   // so no id is resolved here — the screen owns both of its branches.
   {
     key: 'currentTrip',
     icon: 'play',
     title: 'Current Trip',
     subtitle: 'Live trip, totals and tickets',
     accent: 'secondary',
     opens: 'Current Trip',
     value: snapshot.activeTrip ? 'Running now' : 'No trip running',
     extra: snapshot.activeTrip ? `${(0, _libTripTicketsFormat.centavos)(today.earnings)} collected today` : 'Start one from Trips',
    onPress: () => setOpen('currentTrip')
  },
  // Resolves the trip to open from the store: active trip first, else the
  // latest on file. With no trips at all there is nothing to show, so the
  // action is inert rather than opening a screen built around a missing id.
  {
    key: 'tickets',
    icon: 'ticket',
    title: 'Tickets',
    subtitle: 'Fares recorded on a trip',
    accent: 'secondary',
    opens: 'Trip Tickets',
    value: empty ? 'No fares yet' : `${(0, _libHistoryState.plural)(today.ticketCount, 'ticket')} · ${(0, _libTripTicketsFormat.centavos)(today.earnings)}`,
    extra: empty ? 'Nothing recorded yet' : `Across ${(0, _libHistoryState.plural)(today.tripCount, 'trip')} today`,
    onPress: openDefaultTickets
  }, {
    key: 'passenger',
     icon: 'person',
     title: 'Passengers',
     subtitle: 'Anonymous passenger counts',
     accent: 'tertiary',
     opens: 'Passenger summary',
     value: empty ? 'No passengers yet' : `${(0, _libHistoryState.plural)(today.passengerCount, 'passenger')} today`,
     extra: 'Counts only — no passenger names exist',
     onPress: () => setOpen('passenger')
  }, {
    key: 'settings',
     icon: 'settings',
     title: 'Settings',
     subtitle: 'Appearance and configuration',
     accent: 'tertiary',
     opens: 'Settings',
     value: '4 of 4 built',
     extra: 'Fares, terminals, locations and appearance',
     onPress: () => setOpen('settings')
   }];
   let section = open && open in SECTIONS ? SECTIONS[open as keyof typeof SECTIONS] : null;

   // The Dashboard. Every section below this one has a real screen too — this
   // comment used to say otherwise, which is the kind of claim that makes
   // someone delete a working route.
   if (open === 'dashboard') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_DashboardScreen.DashboardScreen, {
       onBack: () => setOpen(null)
       // Handed the app's existing section routing rather than a second
       // navigation system. History and Trip are not built yet, so these
       // return to Home — the same terminal state the placeholder uses.
       ,
       onOpenHistory: () => setOpen('history'),
       onOpenTrip: () => setOpen('trip'),
       onOpenTicket: (_ticketId: any, tripId: any) => {
         // The ledger is scoped by trip: resolve the ticket's own trip so
         // the tap can never land on the tripId-less placeholder net.
         let id = Number(tripId);
         if (Number.isFinite(id)) {
           setTripId(id);
           setOpen('tickets');
         }
       }
     });
   }

   // The Trip screen observes the local store's board directly. Record-ticket
   // and open-completed-trip both land on Trip Tickets for that trip id.
   if (open === 'trip') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_TripScreen.TripScreen, {
       onBack: () => setOpen(null),
       onOpenTickets: (id: any) => {
         setTripId(id);
         setOpen('tickets');
       },
       onAddTrip: () => setOpen('addTrip'),
       onViewAllTrips: () => setOpen('history')
     });
   }

   // Add-trip creates the trip, then hands back to Trip management — the
   // store repaints it; no result is passed across screens. The confirmation
   // sheet's one CTA is the faster road for the conductor who is about to take a
   // fare: straight to the first boarding.
   if (open === 'addTrip') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_AddTripScreen.AddTripScreen, {
       onBack: () => setOpen('trip'),
       onStarted: () => setOpen('trip'),
       onAddFirstBoarding: () => setOpen('addTicket'),
       onOpenFareSettings: () => setOpen('fare')
     });
   }

   // The Tickets section is the first real screen behind the placeholder.
   // It reads the local store directly, so no snapshot is passed through.
   if (open === 'tickets' && tripId !== null) {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_TripTicketsScreen.TripTicketsScreen, {
       tripId: tripId,
       onBack: () => {
         setTripId(null);
         setOpen(null);
       },
       onOpenTrip: () => {
         setTripId(null);
         setOpen('trip');
       },
       onAddTicket: () => setOpen('addTicket'),
       onViewAllTickets: () => {
         setTripId(tripId);
         setOpen('ticketHistory');
       },
       onOpenTicket: (detailTripId: any, detailTicketId: any) => {
         // Both ids, exactly as the History opener passes them — a row tap
         // that only re-set `open` to the section it was already in was a
         // dead press with no visible effect.
         setTripId(detailTripId);
         setTicketId(detailTicketId);
         setTicketDetailBack('tickets');
         setOpen('ticketDetail');
       }
     });
   }

   // Current Trip is the live view of the running trip. Ending a trip there
   // hands the one-shot message to History — the app's existing message
   // channel — and the branch swaps on the store's own observation.
   if (open === 'currentTrip') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_CurrentTripScreen.CurrentTripScreen, {
       onBack: () => setOpen(null),
       onStartTrip: () => setOpen('trip'),
       onRecordFare: openActiveTickets,
       onTripEnded: (message: any) => {
         setTripEndedMessage(message);
         setOpen('history');
       }
     });
   }

   // History reads the same store; the trip-ended message arrives as its
   // existing operationMessage prop and is cleared on close, so it shows once.
   if (open === 'history') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_HistoryScreen.HistoryScreen, {
       onBack: () => {
         setTripEndedMessage(null);
         setOpen(null);
       },
       onOpenTrip: (id: any) => {
         setTripId(id);
         // Read-only: History is a report, so the drill-down cannot record.
         setOpen('ticketsReadOnly');
       },
       operationMessage: tripEndedMessage
     });
   }

   // The trip's full ticket ledger — the "view all tickets" destination of the
   // trip's ticket screen. Scoped to one trip by the required id; rows open
   // ticket detail carrying both ids.
   if (open === 'ticketHistory' && tripId !== null) {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_TicketHistoryScreen.TicketHistoryScreen, {
       tripId: tripId,
       onBack: () => setOpen('tickets')
       // The empty state's one way out: a range search lives in History,
       // which is the one place a range and a filter exist.
       ,
       onSearchRange: () => setOpen('history'),
       onOpenTicket: (historyTripId: any, ticketId: any) => {
         // Both ids preserved explicitly — the detail target is (trip,
         // ticket), never a trip with an implicit ticket.
         setTripId(historyTripId);
         setTicketId(ticketId);
         setTicketDetailBack('ticketHistory');
         setOpen('ticketDetail');
       }
     });
   }

   // The trip's full ticket ledger — the "view all tickets" destination of the
   // trip's ticket screen. Scoped to one trip by the required id; rows open
   // ticket detail carrying both ids.

   // The read-only ledger a History row opens. Same screen as the Tickets
   // section; only the recording rights differ.
   if (open === 'ticketsReadOnly' && tripId !== null) {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_TripTicketsScreen.TripTicketsScreen, {
       tripId: tripId,
       readOnly: true,
       onBack: () => {
         setTripId(null);
         setOpen('history');
       },
       onOpenTrip: () => {
         setTripId(null);
         setOpen('trip');
       },
       onAddTicket: () => setOpen('ticketsReadOnly'),
       onViewAllTickets: () => setOpen('history'),
       onOpenTicket: (detailTripId: any, detailTicketId: any) => {
         // Reading a fare is never gated on write access — a read-only driver
         // still has to be able to open one, or the row is a dead tap. Both ids
         // are held, exactly as in the writable branch.
         setTripId(detailTripId);
         setTicketId(detailTicketId);
         setTicketDetailBack('ticketsReadOnly');
         setOpen('ticketDetail');
       }
     });
   }

   // Ticket detail's own terminal state: the app has no detail screen yet, so
   // a row tap lands on the placeholder rather than silently doing nothing.
   // The ids stay held — when the screen exists, only this branch changes.
   // The fare's receipt — the immutable nine-field row, the trip behind it,
   // and the one amber card in the app when that trip is still running. Both
   // ids arrive exactly as the ledger passed them; back returns to that same
   // ledger, whichever opened it.
   if (open === 'ticketDetail' && tripId !== null && ticketId !== null) {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_TicketDetailScreen.TicketDetailScreen, {
       tripId: tripId,
       ticketId: ticketId,
       backLabel: ticketDetailBack === 'ticketHistory' ? 'Ticket History' : 'Trip tickets',
       onBack: () => {
         setTicketId(null);
         setOpen(ticketDetailBack);
       }
     });
   }

   // Add-ticket is the one screen that does not exit: it records against the
   // trip the store resolves, keeps the route for the next rider, and only
   // leaves for Fare rules when the device has no rules to price with. Back
   // returns to the trip's ticket ledger it was opened from.
   if (open === 'addTicket') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_AddTicketScreen.AddTicketScreen, {
       onBack: () => {
         // Back returns to the ledger it prices against. Opened from Add
         // Trip's "first boarding" the trip id was never held here, so
         // resolving it first keeps the return off the placeholder net.
         if (tripId !== null) {
           setOpen('tickets');
           return;
         }
         void (0, _dataTripTicketsStore.fetchDefaultTripId)().then(id => {
           if (id !== null) {
             setTripId(id);
             setOpen('tickets');
           } else {
             setOpen(null);
           }
         });
       },
       onOpenFareSettings: () => setOpen('fare')
     });
   }

   // The Passenger section is the latest real screen behind the placeholder:
   // anonymous passenger counts for one selected trip, read-only over the same
   // local store the Trip screens write.
   if (open === 'passenger') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_PassengerScreen.PassengerScreen, {
       onBack: () => setOpen(null)
       // No trips on file — the fix is trip management, not this screen.
       ,
       onOpenTrips: () => setOpen('trip')
     });
   }

   // Settings is a navigator: four module cards, and all four now have real
   // screens behind them — Fare, Advanced, Terminal (with its own editor) and
   // Barangay (with two). Each module is registered once and entered only from
   // its own card, so a card cannot land anywhere but its module.
   if (open === 'settings') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_SettingsScreen.SettingsScreen, {
       onBack: () => setOpen(null),
       onOpenFare: () => setOpen('fare'),
       onOpenTerminal: () => setOpen('terminal'),
       onOpenBarangay: () => setOpen('barangay'),
       onOpenAdvanced: () => setOpen('advanced')
     });
   }
   if (open === 'advanced') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_AdvancedSettingsScreen.AdvancedSettingsScreen, {
       onBack: () => setOpen('settings')
     });
   }

   // Fare Configuration: Settings' first module, and the only screen that writes
   // to the fare table. Three inbound sources reach it — the Settings card, and
   // the "no fare rules" states on Add Trip and Add Ticket, which is deliberate:
   // both of those are the moment a conductor discovers this device cannot price
   // a boarding, and both are already looking for the screen that fixes it.
   // One route with three doors is not three routes.
   if (open === 'fare') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_FareSettingsScreen.FareSettingsScreen, {
       onBack: () => setOpen('settings')
     });
   }

   // Terminal Configuration: Settings' second module. Add/edit route to the
   // editor — a separate screen, not built in this prompt — which lands on the
   // section placeholder until it exists. The list itself needs no editor to
   // read, order, search, filter, or deactivate.
   if (open === 'terminal') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_TerminalConfigScreen.TerminalConfigScreen, {
       onBack: () => setOpen('settings'),
       onOpenEditor: (terminalId: any) => {
         setTerminalEditorId(terminalId);
         setOpen('terminalEditor');
       }
     });
   }

   // The terminal editor: one route, one optional id — null is create. The
   // id is already held here, set by the list's add/edit actions; back is
   // the list, whose live observation repaints the changed row.
   if (open === 'terminalEditor') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_TerminalEditorScreen.TerminalEditorScreen, {
       terminalId: terminalEditorId,
       onBack: () => setOpen('terminal')
     });
   }

   // Barangay Configuration: Settings' third module. Two tabs over one
   // screen — barangays and municipalities — with both editors routed from
   // here, each one a route with an optional id held above. The list itself
   // needs no editor to read, search, filter, or deactivate; add and edit are
   // the only affordances that do, and they are the two placeholders below.
   if (open === 'barangay') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_BarangayConfigScreen.BarangayConfigScreen, {
       onBack: () => setOpen('settings'),
       onOpenBarangayEditor: (barangayId: any) => {
         setBarangayEditorId(barangayId);
         setOpen('barangayEditor');
       },
       onOpenMunicipalityEditor: (municipalityId: any) => {
         setMunicipalityEditorId(municipalityId);
         setOpen('municipalityEditor');
       }
     });
   }

   // The two location editors' terminal states. The ids stay held above, so
   // these branches can change without touching the routes. Barangay is wired
   // for both halves; Municipality's `null` half is Add Municipality's two
   // fields, and its id half is the one NAMED placeholder left in this router
   // — `Edit Municipality` has no design yet, deliberately unimplemented and
   // stated here rather than silently shipped. Every other pressable on this
   // screen lands on a screen that does something.
   if (open === 'barangayEditor') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_BarangayEditor.BarangayEditor, {
       id: barangayEditorId,
       onBack: () => setOpen('barangay')
     });
   }

   // `null` = create, a number = edit — both halves are the one screen, as the
   // barangay editor's are. The id used to route to a "not built yet"
   // placeholder, reached from the Barangay Configuration row's own EDIT button.
   if (open === 'municipalityEditor') {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_MunicipalityEditor.MunicipalityEditor, {
       id: municipalityEditorId,
       onBack: () => setOpen('barangay')
     });
   }

   // The net under the whole table. Every SECTIONS key returns above, so this
   // only renders for an `open` value that has no screen — a value nothing sets
   // today. It stays as a net rather than a feature: a new section with no
   // route should say so, not fall through to Home and look like it worked.
   if (section) {
     return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
       style: [styles.screen, {
         paddingTop: insets.top
       }],
       children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsGlassBackdrop.GlassBackdrop, {}), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
         style: [styles.sectionBar, styles.readableWidth],
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
           onPress: () => setOpen(null),
           accessibilityRole: "button",
           accessibilityLabel: "Back to home",
           hitSlop: 12,
           tint: _theme.tintedGlass.accent,
           cornerRadius: _theme.radius.full,
           style: styles.back,
           children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
             style: styles.backIcon,
             children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_icons.Icon, {
               name: "chevronLeft",
               size: 18,
               color: "#FFFFFF"
             })
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: styles.backLabel,
             children: "Home"
           })]
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsGlassCard.GlassCard, {
           tint: _theme.tintedGlass.accent,
           cornerRadius: _theme.radius.full,
           style: styles.titlePill,
           children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: styles.sectionTitle,
             children: section.title
           })
         })]
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.ScrollView, {
         contentContainerStyle: {
           paddingBottom: insets.bottom + (0, _theme.space)(5)
         },
         children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
           style: styles.readableWidth,
         children: /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
           intensity: _theme.glassBlur,
           style: styles.empty,
             children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
               style: styles.emptyIcon,
               children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_icons.Icon, {
             name: section.icon,
             size: 28,
             color: _theme.glass.accentTertiary
               })
             }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.emptyTitle,
               children: section.subtitle
             }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.emptyText,
               children: "Nothing recorded yet. Records appear here once a trip has been started and fares have been saved on this device."
             })]
           })
         })
       })]
     });
   }
   return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
     style: [styles.screen, {
       paddingTop: insets.top
     }],
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsGlassBackdrop.GlassBackdrop, {}), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.ScrollView, {
       contentContainerStyle: [styles.content, {
         paddingBottom: insets.bottom + (0, _theme.space)(4)
       }],
       showsVerticalScrollIndicator: false,
       children: /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
         style: styles.readableWidth,
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsHomeHeader.HomeHeader, {
           tagline: tagline,
           tripLabel: tripPill
         }), hero, showLastTrip ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsHomeLastTripCard.LastTripCard, {
           trip: snapshot.lastCompleted,
           onOpenHistory: () => setOpen('history')
         }) : null, /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
           style: styles.sectionHeading,
           accessibilityRole: "header",
           children: "QUICK ACTIONS"
         }),         /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsQuickActionsGrid.QuickActionsGrid, {
           actions: actions
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsStorageNote.StorageNote, {
           tripCount: snapshot.totals.tripCount,
           ticketCount: snapshot.totals.ticketCount,
           dayCount: snapshot.totals.dayCount,
           style: styles.storageSlot
         })]
       })
     })]
   });
 }
 const styles = _reactNative.StyleSheet.create({
   screen: {
     flex: 1,
     backgroundColor: _theme.glass.backdrop
   },
   content: {
     paddingTop: (0, _theme.space)(2),
     flexGrow: 1
   },
   readableWidth: {
     width: '100%',
     maxWidth: _theme.maxContentWidth,
     alignSelf: 'center',
     // Fills the viewport when there's room to spare, grows past it when there
     // isn't — this is what lets the grid flex instead of scrolling.
     flexGrow: 1
   },
   sectionHeading: {
     ..._theme.type.labelSmall,
     color: _theme.palette.onSurfaceVariant,
     marginTop: (0, _theme.space)(5),
     marginBottom: (0, _theme.space)(3),
     marginHorizontal: (0, _theme.space)(5)
   },
   // The page inset only: the note keeps the component's own 20px top margin, and
   // without this the card ran full-bleed to both screen edges.
   storageSlot: {
     marginHorizontal: (0, _theme.space)(5)
   },
   sectionBar: {
     flexDirection: 'row',
     alignItems: 'center',
     gap: (0, _theme.space)(3),
     paddingHorizontal: (0, _theme.space)(4),
     paddingVertical: (0, _theme.space)(3)
   },
   // ORANGE GLASS, the shared SectionChrome pair: solid accent fill, lit 1px
   // lip. The only headers outside SectionChrome — the two "not built yet"
   // nets — so the placeholder screens still read as this app.
   back: {
     flexDirection: 'row',
     alignItems: 'center',
     gap: (0, _theme.space)(1.5),
     minHeight: 44,
     paddingHorizontal: (0, _theme.space)(3),
     borderRadius: _theme.radius.full
   },
   backIcon: {
     width: 20,
     height: 20,
     alignItems: 'center',
     justifyContent: 'center'
   },
   backLabel: {
     ..._theme.type.labelLarge,
     color: '#FFFFFF'
   },
   titlePill: {
     flex: 1,
     minWidth: 0,
     alignItems: 'center',
     justifyContent: 'center',
     minHeight: 44,
     paddingHorizontal: (0, _theme.space)(4),
     paddingVertical: (0, _theme.space)(1.25),
     borderRadius: _theme.radius.full
   },
   sectionTitle: {
     ..._theme.type.titleMedium,
     color: '#FFFFFF'
   },
   empty: {
     marginTop: (0, _theme.space)(6),
     padding: (0, _theme.space)(5),
     // Glass, like every other panel on the screen: the reference has no
     // opaque card, so the fill and border go and the card keeps only its
     // shape over the shared surface.
     borderRadius: _theme.radius.glass
   },
   emptyIcon: {
     width: 56,
     height: 56,
     alignItems: 'center',
     justifyContent: 'center'
   },
   emptyTitle: {
     ..._theme.type.titleMedium,
     color: _theme.glass.onGlass,
     marginTop: (0, _theme.space)(3)
   },
   emptyText: {
     ..._theme.type.bodyMedium,
     color: _theme.glass.onGlassVariant,
     marginTop: (0, _theme.space)(2)
   }
 });


export { HomeScreen };

