import * as _react from 'react';
import * as _reactNative from 'react-native';
import * as _reactNativeSafeAreaContext from 'react-native-safe-area-context';
import * as _componentsGlassCard from '../components/GlassCard';
import * as _componentsSectionChrome from '../components/SectionChrome';
import * as _componentsBottomSheet from '../components/BottomSheet';
import * as _icons from '../icons';
import * as _theme from '../theme';
import * as _dataTripTicketsStore from '../data/tripTicketsStore';
import * as _dataFareStore from '../data/fareStore';
import * as _libAddTicketFare from '../lib/addTicketFare';
import * as _libAddTripState from '../lib/addTripState';
import * as _libTripTicketsFormat from '../lib/tripTicketsFormat';
import * as _libUpdateGuard from '../lib/updateGuard';
import type { TicketRowRecord, TerminalRowRecord, TripRowRecord } from '../data/schema';
import * as _reactJsxRuntime from 'react/jsx-runtime';

                               /** The app's shared storage-failure copy — no bespoke wording here. */let STORAGE_FAILURE = 'The records on this device could not be read.';
 let SIDE = {
   BOARD: 'board',
   DROP: 'drop'
 };

 /** Everything the screen reads in one go, before it can price anything. */
type Observation = {
  loading: boolean;
  error: string | null;
  trip: TripRowRecord | null;
  tickets: TicketRowRecord[];
  terminals: TerminalRowRecord[];
  fare: _dataFareStore.FareConfigurationRow | null;
  sctex: _dataFareStore.SctexConfigurationRow | null;
};

/** What the confirmation sheet prints. Captured at the press, not re-derived. */

 let EMPTY_OBSERVATION = {
   loading: true,
   error: null,
   trip: null,
   tickets: [],
   terminals: [],
   fare: null,
   sctex: null
 };
 /**
  * The Add-ticket screen — where a conductor prices and records a fare.
  *
  * The fare card is the centre of the screen because it **is** the calculator:
  * the store creates the fare table and is handed `farePerPassenger` on insert,
  * so nothing else in the app can price a boarding. Every step is printed
  * (distance, adjustment, billable distance, rate, per passenger, total) so a
  * peso in dispute traces back to the rule that produced it, and the fare is
  * deliberately not editable — a price the rules then contradict is how a shift
  * gets counted twice.
  *
  * The screen does not exit after a record. The trip is still running, so a
  * commit confirms in a sheet, keeps the route, the road and the fare type (the
  * next rider boards at the same stop on the same bus), resets only the
  * quantity, and hands the conductor back to the same filled form. The ledger of
  * what has already been saved therefore lives at the bottom of this screen
  * rather than only on Trip tickets — it is the receipt for the press that just
  * happened.
  *
  * Three numbers are never mixed: the pending fare (the chrome), the saved
  * total (the list head) and the total being recorded (the confirmation). The UI
  * never adds the first two.
  */
 function AddTicketScreen({
   onBack,
   onOpenFareSettings
 }: { [key: string]: any }) {
   let insets = (0, _reactNativeSafeAreaContext.useSafeAreaInsets)();
   let [observation, setObservation] = _react.useState<Observation>(EMPTY_OBSERVATION);
   let [retryToken, setRetryToken] = (0, _react.useState)(0);
   // The retry is an event, so the loading flip happens in the handler rather
   // than in an effect: one render per attempt, and the screen's own insert
   // never flashes the skeleton over the fare it just wrote.
   let retry = (0, _react.useCallback)(() => {
     setObservation(current => ({
       ...current,
       loading: true,
       error: null
     }));
     setRetryToken(token => token + 1);
   }, []);

   // The four settings and the quantity. Nothing derived is stored: distance,
   // validity and the fare itself are recomputed at the point of use, so a
   // changed input cannot leave a stale peso on screen.
   let [board, setBoard] = _react.useState<_libAddTicketFare.TerminalRow | null>(null);
   let [drop, setDrop] = _react.useState<_libAddTicketFare.TerminalRow | null>(null);
   let [roadChoice, setRoadChoice] = _react.useState<boolean | null>(null);
  let [passengerType, setPassengerType] = _react.useState<_libAddTicketFare.PassengerType>('REGULAR');
  let [quantity, setQuantity] = (0, _react.useState)(_libAddTicketFare.QTY_MIN);
  // While a boarding is being composed, the update system must not pop its
  // "Update available" sheet or restart the app over this form.
  (0, _libUpdateGuard.useUpdateGuard)('add-ticket');
   let [sheet, setSheet] = _react.useState<string | null>(null);
   let [openTicket, setOpenTicket] = _react.useState<any>(null);
   let [recorded, setRecorded] = _react.useState<any>(null);
   let [recording, setRecording] = (0, _react.useState)(false);
   // A press that lands before the next render still reads `recording` as false
   // — state flips too late to guard the same tick. The ref flips now, so a
   // double-press cannot insert the same boarding twice.
   let recordingRef = (0, _react.useRef)(false);
   let [writeError, setWriteError] = _react.useState<string | null>(null);
   (0, _react.useEffect)(() => {
     let cancelled = false;
     let run = () => {
       // Four reads, one observation. The trip is resolved by the store's own
       // entry-point rule, so the screen never needs an id handed to it.
       (0, _dataTripTicketsStore.fetchDefaultTripId)().then(tripId => Promise.all([tripId === null ? Promise.resolve({
         trip: null,
         tickets: []
       }) : (0, _dataTripTicketsStore.fetchTripWithTickets)(tripId),
       // Every terminal, not the active subset: the store tells a missing
       // row from a deactivated one, and so does the refusal beside the
       // commit button. An active-only read cannot tell them apart.
       (0, _dataTripTicketsStore.fetchAllTerminals)(), (0, _dataFareStore.fetchFareConfiguration)()])).then(([read, terminals, fares]) => {
         if (cancelled) return;
         setObservation({
           loading: false,
           error: null,
           trip: read.trip,
           tickets: read.tickets,
           terminals,
           fare: fares.fare,
           sctex: fares.sctex
         });
       }).catch(error => {
         if (cancelled) return;
         setObservation(current => ({
           ...current,
           loading: false,
           error: error instanceof Error ? error.message : STORAGE_FAILURE
         }));
       });
     };
     run();
     // One subscription: trips, the ledger and the fare configuration all write
     // through the same database handle, so this repaints the whole observation.
     let unsubscribe = (0, _dataTripTicketsStore.subscribeToTrips)(run);
     return () => {
       cancelled = true;
       unsubscribe();
     };
   }, [retryToken]);
   let view = (0, _libAddTicketFare.computeAddTicketView)(observation);
   let ready = view.kind === 'ready' ? view : null;
   let noFares = view.kind === 'nofares' ? view : null;
   let trip = ready?.trip ?? noFares?.trip ?? null;
   let rules = ready?.rules ?? null;
   let tickets = ready?.tickets ?? noFares?.tickets ?? [];
   // The store's terminal read is unordered; the sheet sorts by KM so the list
   // reads as the route's geography rather than as insert order.
   let terminals = [...(ready?.terminals ?? noFares?.terminals ?? observation.terminals)].sort((a, b) => a.km_marker - b.km_marker || a.id - b.id);

   // The road is a setting on the trip and is stored with it, so this screen
   // reads the trip's own value and only overrides it once the conductor taps.
   // Null means "not touched yet", which is what makes the control follow a trip
   // that was started on the express way without a mount-time copy going stale.
   let tripUsesExpressWay = (ready?.trip ?? noFares?.trip)?.uses_sctex === 1;
   let usesExpressWay = roadChoice ?? tripUsesExpressWay;
   let setUsesExpressWay = (0, _react.useCallback)((value: any) => setRoadChoice(value), []);
   let distanceMilli = (0, _libAddTicketFare.routeDistanceMilli)(board, drop);
   let breakdown = rules ? (0, _libAddTicketFare.priceTicket)({
     distanceMilli,
     usesExpressWay,
     passengerType,
     quantity,
     rules
   }) : null;
   let blockReason = (0, _libAddTicketFare.commitBlockReason)({
     board,
     drop,
     terminals,
     rules
   });
   let fold = (0, _libAddTicketFare.foldLedger)(tickets);
   let capLine = (0, _libAddTicketFare.ledgerCapLine)(fold);
   let canRecord = ready !== null && breakdown !== null && blockReason === null && !recording;
   let onRecord = () => {
     if (!canRecord || recordingRef.current || !breakdown || !ready || !board || !drop) return;
     recordingRef.current = true;
     // Snapshotted at the press, before the write, because the quantity resets
     // to 1 the moment the ticket lands and the sheet must print the group that
     // boarded. The clock is read here, at the press, for the same reason.
     let recordedAt = new Date().getTime();
     let snapshot = {
       board,
       drop,
       distanceMilli: breakdown.distanceMilli,
       billableMilli: breakdown.billableMilli,
       rateCentavos: breakdown.rateCentavos,
       usesExpressWay,
       passengerType,
       quantity: (0, _libAddTicketFare.clampQuantity)(quantity),
       perPassengerCentavos: breakdown.perPassengerCentavos,
       totalCentavos: breakdown.totalCentavos,
       recordedAt
     };
     setRecording(true);
     setWriteError(null);
     void (0, _dataTripTicketsStore.recordTicketRow)({
       tripId: ready.trip.id,
       origin: board.name,
       destination: drop.name,
       passengerType,
       passengerQuantity: (0, _libAddTicketFare.clampQuantity)(quantity),
       farePerPassenger: breakdown.perPassengerCentavos
     }).then(() => {
       recordingRef.current = false;
       setRecording(false);
       // The four settings carry over: the next group boards at the same stop
       // on the same bus. The quantity does not — a group of twenty is one
       // boarding, and leaving that number standing charges them twice.
       setQuantity(_libAddTicketFare.QTY_MIN);
       setRecorded(snapshot);
       setSheet('recorded');
     }).catch(error => {
       recordingRef.current = false;
       setRecording(false);
       setWriteError(error instanceof Error ? error.message : STORAGE_FAILURE);
     });
   };
   let subtitle = (() => {
     if (view.kind === 'loading') return 'Reading this trip…';
     if (view.kind === 'error') return 'The records could not be read';
     if (view.kind === 'notrips') return 'No trip is running on this device';
     let amount = breakdown ? (0, _libAddTicketFare.formatPeso)(breakdown.totalCentavos) : null;
     return amount === null ? `No route priced · Trip #${trip?.trip_number ?? '—'}` : `${amount} · Trip #${trip?.trip_number ?? '—'}`;
   })();
   return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsSectionChrome.SectionChrome, {
     title: "Add ticket",
     titleMinHeight: 56,
     subtitle: subtitle,
     onBack: onBack,
     insets: insets,
     testID: "at-chrome",
     backTestID: "at-back",
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.ScrollView, {
       style: styles.screen,
       contentContainerStyle: [styles.column, {
         paddingBottom: insets.bottom + (0, _theme.space)(6)
       }],
       showsVerticalScrollIndicator: false,
       children: [view.kind === 'loading' ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(LoadingState, {}) : null, view.kind === 'error' ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
         testID: "at-rules",
         style: styles.gutter,
         children: /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
           testID: "at-error",
           style: [styles.stateCard, styles.errorCard],
           children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: styles.stateTitle,
             accessibilityRole: "header",
             children: "Local records could not be read"
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: styles.stateBody,
             accessibilityLiveRegion: "polite",
             children: view.message
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Pressable, {
             onPress: retry,
             testID: "at-retry",
             accessibilityRole: "button",
             accessibilityLabel: "Retry reading this trip",
             style: ({
               pressed
             }: { [key: string]: any }) => [styles.ghostButton, pressed && styles.pressed],
             children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.ghostButtonLabel,
               children: "Try again"
             })
           })]
         })
       }) : null, view.kind === 'notrips' ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
         testID: "at-rules",
         style: styles.gutter,
         children: /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
           testID: "at-notrips",
           style: styles.stateCard,
           children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: styles.stateTitle,
             accessibilityRole: "header",
             children: "No trip is running"
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: styles.stateBody,
             children: "A ticket is recorded against a trip, so there is nothing to add one to. Start a trip and this screen will price the next boarding."
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.Handoff, {
             children: "Trip management, where a trip is started"
           })]
         })
       }) : null, noFares ?
       /*#__PURE__*/
       // The route stays visible: the conductor can see what they picked,
       // and only the money is missing. Committing is refused rather than
       // storing a wrong peso.
       (0, _reactJsxRuntime.jsxs)(_reactJsxRuntime.Fragment, {
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
           testID: "at-form",
           children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(RouteCard, {
             board: board,
             drop: drop,
             distanceMilli: distanceMilli,
             warning: blockReason,
             onOpenBoard: () => setSheet(SIDE.BOARD),
             onOpenDrop: () => setSheet(SIDE.DROP)
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(RoadCard, {
             usesExpressWay: usesExpressWay,
             onChange: setUsesExpressWay,
             rules: rules
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(PassengerCard, {
             passengerType: passengerType,
             quantity: quantity,
             onType: setPassengerType,
             onQuantity: setQuantity
           })]
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
           testID: "at-rules",
           style: styles.gutter,
           children: /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
             testID: "at-nofares",
             style: styles.stateCard,
             children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.stateTitle,
               accessibilityRole: "header",
               children: "No fare rules are set on this device"
             }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.stateBody,
               children: "A ticket records a fare, so the fare has to come from somewhere. This device has no fare rules yet, so nothing can be priced or recorded until they are set. The route above stays visible so the boarding you picked is not lost."
             }), onOpenFareSettings ? /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Pressable, {
               onPress: onOpenFareSettings,
               accessibilityRole: "button",
               accessibilityLabel: "Set up fare rules on this device",
               style: ({
                 pressed
               }: { [key: string]: any }) => [styles.solidButton, pressed && styles.pressed],
               children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsGlassCard.GlassCard, {
                 tint: _theme.tintedGlass.accent,
                 cornerRadius: _theme.radius.large,
                 style: _reactNative.StyleSheet.absoluteFill,
                 pointerEvents: "none"
               }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
                 style: styles.solidButtonLabel,
                 children: "Set up fare rules"
               })]
             }) : null, /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.Handoff, {
               children: "Fare settings, where the minimum fare, the minimum distance and the per-kilometre rates are configured"
             })]
           })
         })]
       }) : null, ready ? /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactJsxRuntime.Fragment, {
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
           testID: "at-form",
           children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(RouteCard, {
             board: board,
             drop: drop,
             distanceMilli: distanceMilli,
             warning: blockReason,
             onOpenBoard: () => setSheet(SIDE.BOARD),
             onOpenDrop: () => setSheet(SIDE.DROP)
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(RoadCard, {
             usesExpressWay: usesExpressWay,
             onChange: setUsesExpressWay,
             rules: rules
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(PassengerCard, {
             passengerType: passengerType,
             quantity: quantity,
             onType: setPassengerType,
             onQuantity: setQuantity
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(FareCard, {
             breakdown: breakdown,
             rules: ready.rules,
             board: board,
             drop: drop,
             usesExpressWay: usesExpressWay,
             passengerType: passengerType,
             quantity: quantity,
             tripNumber: trip?.trip_number,
             onOpenRules: () => setSheet('rules')
           })]
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
           testID: "at-commit",
           style: styles.gutter,
           children: [blockReason ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: styles.blockReason,
             accessibilityLiveRegion: "polite",
             children: blockReason
           }) : null, /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Pressable, {
             onPress: onRecord,
             disabled: !canRecord,
             testID: "at-record",
             accessibilityRole: "button"
             // The accessible name must contain the visible label (WCAG 2.5.3):
             // a screen reader announces the visible words first, the refusal second.
             ,
             accessibilityLabel: [recording ? 'Recording…' : breakdown ? `Record ${(0, _libAddTicketFare.formatPeso)(breakdown.totalCentavos)} ticket` : 'Record ticket', blockReason].filter(Boolean).join('. '),
             accessibilityState: {
               disabled: !canRecord,
               busy: recording
             },
             style: ({
               pressed
             }: { [key: string]: any }) => [styles.solidButton, !canRecord && styles.solidButtonDisabled, pressed && canRecord && styles.pressed],
             children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.solidButtonLabel,
               children: recording ? 'Recording…' : breakdown ? `Record ${(0, _libAddTicketFare.formatPeso)(breakdown.totalCentavos)} ticket` : 'Record ticket'
             })
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: styles.hint,
             children: `Records against trip #${trip?.trip_number ?? '—'}, is counted on the trip and on Home, and cannot be edited afterwards. It appears in the list below, and the next boarding starts from here.`
           }), writeError ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: styles.blockReason,
             accessibilityLiveRegion: "assertive",
             children: writeError
           }) : null]
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
           testID: "at-recent",
           style: styles.recentSection,
           children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
             style: styles.sectionHead,
             children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.sectionLabel,
               accessibilityRole: "header",
               children: "RECENT TICKETS"
             }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               testID: "at-recent-total",
               style: styles.sectionTotal,
               children: (0, _libAddTicketFare.formatPeso)(fold.head.totalCentavos)
             })]
           }), fold.recent.length === 0 ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
             testID: "at-recent-empty",
             style: styles.gutter,
             children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsGlassCard.GlassCard, {
               style: styles.emptyCard,
               children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
                 style: styles.stateBody,
                 children: `Nothing recorded on trip #${trip?.trip_number ?? '—'} yet. Every fare recorded here lands at the top of this list, which is how a boarding gets checked without leaving the screen.`
               })
             })
           }) : /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
             testID: "at-recent-list",
             style: styles.recentList,
             children: fold.recent.map(row => /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Pressable, {
               testID: `at-recent-${row.id}`,
               onPress: () => {
                 setOpenTicket(row);
                 setSheet('ticket');
               },
               accessibilityRole: "button",
               accessibilityLabel: `Ticket ${row.id}, ${row.origin_location_snapshot} to ${row.destination_location_snapshot}, ${(0, _libAddTicketFare.formatPeso)(row.total_fare)}`,
               accessibilityHint: "Opens this recorded ticket",
               style: ({
                 pressed
               }: { [key: string]: any }) => [pressed && styles.pressed],
               children: /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
                 style: styles.recentRow,
                 children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
                   style: styles.recentBody,
                   children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Text, {
                     style: styles.recentRoute,
                     numberOfLines: 2,
                     children: [row.origin_location_snapshot, " \u2192 ", row.destination_location_snapshot]
                   }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
                     style: styles.recentMeta,
                     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
                       style: [styles.recentCat, row.passenger_type === 'REGULAR' ? styles.recentCatRegular : styles.recentCatDiscount],
                       children: _libAddTicketFare.PASSENGER_TYPES.find((entry: any) => entry.key === row.passenger_type)?.label ?? passengerTypeLabel(row.passenger_type)
                     }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
                       style: styles.recentMetaText,
                       numberOfLines: 1,
                       children: [row.passenger_quantity, ' ', row.passenger_quantity === 1 ? 'passenger' : 'passengers', " \xB7", ' ', (0, _libTripTicketsFormat.formatRowStamp)(row.created_at)]
                     })]
                   })]
                 }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
                   style: styles.recentSide,
                   children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
                     style: styles.recentAmount,
                     children: (0, _libAddTicketFare.formatPeso)(row.total_fare)
                   }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Text, {
                     style: styles.recentId,
                     children: ["#", row.id]
                   })]
                 })]
               })
             }, row.id))
           }), capLine ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             testID: "at-recent-cap",
             style: styles.capLine,
             children: capLine
           }) : null]
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
           testID: "storage-footer",
           style: styles.storageCard,
           children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_icons.Icon, {
             name: "database",
             size: 18,
             color: _theme.glass.accentTertiary
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: styles.storageNote,
             children: "Stored on this device only. The fare is calculated from the trip and the fare rules, and the number is saved with the ticket."
           })]
         })]
       }) : null]
     }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(TerminalSheet
     // Remounts on every open so a previous search cannot filter the next
     // boarding's list before the conductor sees it.
     , {
       kind: sheet === SIDE.BOARD ? SIDE.BOARD : sheet === SIDE.DROP ? SIDE.DROP : null,
       // Barangays only: terminals are the route's ends, not boardings. The
       // commit refusal still reads the whole list for its missing /
       // deactivated sentences.
       terminals: terminals.filter(stop => stop.kind === 'BARANGAY'),
       other: sheet === SIDE.BOARD ? drop : board,
       onClose: () => setSheet(null),
       onSelect: (terminal: any) => {
         if (sheet === SIDE.BOARD) setBoard(terminal);else if (sheet === SIDE.DROP) setDrop(terminal);
         setWriteError(null);
         setSheet(null);
       }
     }, sheet ?? 'closed'), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(FareRulesSheet, {
       visible: sheet === 'rules',
       rules: rules,
       onClose: () => setSheet(null)
     }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(RecordedSheet, {
       visible: sheet === 'recorded',
       recorded: recorded,
       tripNumber: trip?.trip_number,
       tripTotalCentavos: fold.head.totalCentavos,
       tripTicketCount: fold.head.count,
       onRecordAnother: () => setSheet(null)
     }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(TicketSheet, {
       visible: sheet === 'ticket',
       ticket: openTicket,
       trip: trip,
       rules: rules,
       usesExpressWay: usesExpressWay,
       onClose: () => setSheet(null)
     })]
   });
 }

 // ── ROUTE ────────────────────────────────────────────────────────────────────

 /**
  * Boarding point, then destination, then the leg. The leg line is the first
  * thing on the screen that reacts to input, and it reports the failure in the
  * store's words rather than a generic "invalid route".
  */
 function RouteCard({
   board,
   drop,
   distanceMilli,
   warning,
   onOpenBoard,
   onOpenDrop
 }: { [key: string]: any }) {
   let legWarning = board !== null && drop !== null ? warning : null;
   return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactJsxRuntime.Fragment, {
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
       testID: "at-route-card",
       style: styles.card,
       children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
         style: styles.fieldGroup,
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(TerminalField, {
           testID: "at-board",
           label: "BOARDING POINT",
           placeholder: "Choose where they get on",
           terminal: board,
           onPress: onOpenBoard
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(TerminalField, {
           testID: "at-drop",
           label: "DESTINATION",
           placeholder: "Choose where they get off",
           terminal: drop,
           onPress: onOpenDrop
         })]
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
         style: styles.leg,
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
           style: styles.legLine,
           accessibilityElementsHidden: true,
           importantForAccessibility: "no-hide-descendants"
         }),         /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
           style: styles.legText,
           children: legWarning || distanceMilli === null ? 'Distance is not set until both ends are chosen.' : `${(0, _libAddTicketFare.formatKm)(distanceMilli)} between barangays`
         })]
       })]
     }), legWarning ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
       style: [styles.legWarning, styles.legWarnBelow],
       accessibilityLiveRegion: "polite",
       children: legWarning
     }) : null]
   });
 }
 function TerminalField({
   testID,
   label,
   placeholder,
   terminal,
   onPress
 }: { [key: string]: any }) {
   return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Pressable, {
     onPress: onPress,
     testID: testID,
     accessibilityRole: "button",
     accessibilityLabel: `${label}. ${terminal ? `${terminal.name}, ${(0, _libAddTicketFare.formatKm)(terminal.km_marker)}` : 'Not chosen'}. Opens the barangay list.`,
     style: ({
       pressed
     }: { [key: string]: any }) => [styles.field, pressed && styles.pressed],
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
       style: styles.fieldIcon,
       children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_icons.Icon, {
         name: "terminal",
         size: 20,
         color: _theme.palette.onTertiaryContainer
       })
     }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
       style: styles.fieldBody,
       children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.fieldLabel,
         children: label
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: [styles.fieldValue, !terminal && styles.fieldPlaceholder],
         numberOfLines: 1,
         children: terminal ? terminal.name : placeholder
       })]
     }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_icons.Icon, {
       name: "chevron",
       size: 18,
       color: _theme.palette.onSurfaceVariant
     })]
   });
 }

 // ── ROAD ─────────────────────────────────────────────────────────────────────

 /**
  * The trip's road, not a per-ticket one.
  *
  * `usesExpressWay` is a setting on the trip and prices every ticket on it, so the
  * note spells the consequence out: a per-ticket switch here would be a lie
  * about the schema the store writes to.
  */
 function RoadCard({
   usesExpressWay,
   onChange,
   rules
 }: { [key: string]: any }) {
   return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
     testID: "at-road-card",
     style: styles.card,
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
       style: styles.sectionLabel,
       accessibilityRole: "header",
       children: "ROAD"
     }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
       style: styles.roadRow,
       children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(RoadButton, {
         testID: "at-road-ordinary",
         title: "Ordinary",
         sub: "National road",
         pressed: !usesExpressWay,
         onPress: () => onChange(false)
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(RoadButton, {
         testID: "at-road-sctex",
         title: "SCTEX",
         sub: "Subic\u2013Clark\u2013Tarlac",
         pressed: usesExpressWay,
         onPress: () => onChange(true)
       })]
     }), usesExpressWay ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
       style: styles.note,
       children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.noteText,
         children: rules ? `The express way charges ${(0, _libAddTicketFare.formatRate)(rules.expressRatePerKmCentavos)} per km instead of ${(0, _libAddTicketFare.formatRate)(rules.ratePerKmCentavos)} per km. The road is stored on the trip, so every ticket on it records at that rate.` : 'The express way charges a higher per-kilometre rate. The exact rate comes from the fare rules this device has not saved yet.'
       })
     }) : null]
   });
 }
 function RoadButton({
   testID,
   title,
   sub,
   pressed,
   onPress
 }: { [key: string]: any }) {
   return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Pressable, {
     onPress: onPress,
     testID: testID,
     accessibilityRole: "button",
     accessibilityLabel: `${title}. ${sub}`,
     accessibilityState: {
       selected: pressed
     },
     style: ({
       pressed: isPressed
     }: { [key: string]: any }) => [styles.roadButton, pressed && styles.roadButtonActive, isPressed && styles.pressed],
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
       style: [styles.roadTitle, pressed && styles.roadTitleActive],
       children: title
     }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
       style: [styles.roadSub, pressed && styles.roadSubActive],
       numberOfLines: 1,
       children: sub
     })]
   });
 }

 // ── PASSENGERS ───────────────────────────────────────────────────────────────

 /**
  * The fare key, then the group size. The chip's word is prose; the value is the
  * column the rate is read from — `SENIOR_CITIZEN`, with the second I. A
  * decorative chip is a discount the operator cannot honour.
  */
 function PassengerCard({
   passengerType,
   quantity,
   onType,
   onQuantity
 }: { [key: string]: any }) {
   return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
     testID: "at-pax-card",
     style: styles.card,
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
       style: styles.sectionLabel,
       accessibilityRole: "header",
       children: "PASSENGER"
     }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
       style: styles.chipRow,
       children: _libAddTicketFare.PASSENGER_TYPES.map(entry => {
         let selected = entry.key === passengerType;
         return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Pressable, {
           onPress: () => onType(entry.key),
           testID: `at-pt-${entry.key}`,
           accessibilityRole: "button",
           accessibilityLabel: `${entry.label} fare rate`,
           accessibilityState: {
             selected
           },
           style: ({
             pressed
           }: { [key: string]: any }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed],
           children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             style: [styles.chipLabel, selected && styles.chipLabelSelected],
             numberOfLines: 1,
             children: entry.label
           })
         }, entry.key);
       })
     }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
       testID: "at-qty",
       style: styles.stepper,
       children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Pressable, {
         onPress: () => onQuantity((0, _libAddTicketFare.clampQuantity)(quantity - 1)),
         testID: "at-qty-down",
         disabled: quantity <= _libAddTicketFare.QTY_MIN,
         accessibilityRole: "button",
         accessibilityLabel: "One passenger fewer",
         accessibilityState: {
           disabled: quantity <= _libAddTicketFare.QTY_MIN
         },
         style: ({
           pressed
         }: { [key: string]: any }) => [styles.stepperButton, quantity <= _libAddTicketFare.QTY_MIN && styles.stepperButtonDisabled, pressed && styles.pressed],
         children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
           style: styles.stepperGlyph,
           children: "\u2212"
         })
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Text, {
         testID: "at-qty-value",
         style: styles.stepperValue,
         accessibilityLiveRegion: "polite",
         children: [quantity, " ", quantity === 1 ? 'passenger' : 'passengers']
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Pressable, {
         onPress: () => onQuantity((0, _libAddTicketFare.clampQuantity)(quantity + 1)),
         testID: "at-qty-up",
         disabled: quantity >= _libAddTicketFare.QTY_MAX,
         accessibilityRole: "button",
         accessibilityLabel: "One passenger more",
         accessibilityState: {
           disabled: quantity >= _libAddTicketFare.QTY_MAX
         },
         style: ({
           pressed
         }: { [key: string]: any }) => [styles.stepperButton, quantity >= _libAddTicketFare.QTY_MAX && styles.stepperButtonDisabled, pressed && styles.pressed],
         children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_icons.Icon, {
           name: "plus",
           size: 20,
           color: _theme.palette.onPrimary
         })
       })]
     })]
   });
 }

 // ── FARE ─────────────────────────────────────────────────────────────────────

 /**
  * The calculator, as a table of label/value pairs so it reads as arithmetic
  * rather than as a wall of numbers.
  *
  * On amber, text is never `onPrimary` and never white: the four `onAmber` inks
  * are the only permitted colours here. The rows are conditional — the rate
  * label names the rate that actually applied.
  */
 function FareCard({
   breakdown,
   rules,
   board,
   drop,
   usesExpressWay,
   passengerType,
   quantity,
   tripNumber,
   onOpenRules
 }: { [key: string]: any }) {
   let notes = breakdown ? (0, _libAddTicketFare.minimumNotes)(breakdown, rules) : [];
   let pax = (0, _libAddTicketFare.clampQuantity)(quantity);
   return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
     testID: "at-fare",
     children: /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
       testID: "at-fare-card",
       style: styles.fareCard,
       children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.fareLabel,
         accessibilityRole: "header",
         children: "FARE"
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.fareSub,
         children: (0, _libAddTicketFare.compositionLabel)(passengerType, pax)
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Text, {
         style: styles.fareRoute,
         numberOfLines: 2,
         children: [board?.name ?? '—', " \u2192 ", drop?.name ?? '—']
       }), breakdown ? /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
         style: styles.calc,
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(FareRow, {
           label: "Distance",
           value: (0, _libAddTicketFare.formatKm)(breakdown.distanceMilli)
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(FareRow, {
           label: "Billable distance",
           value: (0, _libAddTicketFare.formatKm)(breakdown.billableMilli)
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(FareRow, {
           label: breakdown.rateLabel,
           value: (0, _libAddTicketFare.formatRate)(breakdown.rateCentavos)
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(FareRow, {
           label: "Fare per passenger",
           value: (0, _libAddTicketFare.formatPeso)(breakdown.perPassengerCentavos)
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
           style: styles.sumRow,
           children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Text, {
             style: styles.sumLabel,
             numberOfLines: 2,
             children: ["Total \xB7 ", pax, " ", pax === 1 ? 'passenger' : 'passengers']
           }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
             testID: "at-total",
             style: styles.sumValue,
             accessibilityLabel: `Total ${(0, _libAddTicketFare.formatPeso)(breakdown.totalCentavos)}`,
             children: (0, _libAddTicketFare.formatPeso)(breakdown.totalCentavos)
           })]
         })]
       }) : /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
         style: styles.calc,
         children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
           style: styles.fareNote,
           children: "Choose a boarding point and a destination and the fare is worked out here."
         })
       }), notes.map(note => /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.fareNote,
         children: note
       }, note)), (0, _libAddTicketFare.takesSpecialRate)(passengerType) ? /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Text, {
         style: styles.fareNote,
         children: [(0, _libAddTicketFare.formatRate)(breakdown?.rateCentavos ?? 0), " is a flat rate per kilometre, not a discount off the express way price. A discounted passenger pays it on either road, and the minimum fare still applies."]
       }) : null, usesExpressWay ? /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Text, {
         style: styles.fareNote,
         children: ["The road is a setting on trip #", tripNumber ?? '—', ", so it prices every ticket on this trip."]
       }) : null, /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Pressable, {
         onPress: onOpenRules,
         testID: "at-rules-open",
         accessibilityRole: "button",
         accessibilityLabel: "Open the fare rules this fare is worked out from",
         style: ({
           pressed
         }: { [key: string]: any }) => [styles.fareRulesAction, pressed && styles.pressed],
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
           style: styles.fareRulesActionLabel,
           children: "HOW THIS IS CALCULATED"
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_icons.Icon, {
           name: "chevron",
           size: 14,
           color: _theme.onAmber.primary
         })]
       })]
     })
   });
 }
 function FareRow({
   label,
   value
 }: { [key: string]: any }) {
   return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
     style: styles.calcRow,
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
       style: styles.calcLabel,
       numberOfLines: 1,
       children: label
     }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
       style: styles.calcValue,
       children: value
     })]
   });
 }
 function TerminalSheet({
   kind,
   terminals,
   other,
   onClose,
   onSelect
 }: { [key: string]: any }) {
   // One sheet, two titles, gated on which end of the route asked for it — a
   // `visible` shortcut would leave the modal mounted for the whole screen.
   let [query, setQuery] = (0, _react.useState)('');
   if (kind === null) return null;
   let otherLabel = kind === SIDE.DROP ? 'boarding point' : 'destination';
   // Case-insensitive, partial, live — the same filter the Add trip sheet uses,
   // so both barangay pickers answer a typed name the same way.
   let results = (0, _libAddTripState.filterTerminals)(terminals, query);
   return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsBottomSheet.Sheet, {
     kind: kind,
     title: kind === SIDE.DROP ? 'Destination' : 'Boarding point',
     subtitle: `${terminals.length} barangay${terminals.length === 1 ? '' : 's'} on this device`,
     onClose: onClose,
     fill: true,
      children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.TextInput, {
        value: query,
        onChangeText: setQuery,
        placeholder: "Search barangay names",
        placeholderTextColor: _theme.palette.outline,
        accessibilityLabel: kind === SIDE.DROP ? "Search destination barangays" : "Search boarding point barangays",
        style: styles.search
      }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.FlatList, {
       data: results,
       keyExtractor: (terminal: any) => String(terminal.id),
       style: styles.sheetList,
       // A row taps through on the first touch with the keyboard open — the
       // same rule Add trip's picker uses.
       keyboardShouldPersistTaps: "handled",
       renderItem: ({
         item
       }: { [key: string]: any }) => {
         let state = (0, _libAddTicketFare.terminalPickState)(item, other);
         return /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Pressable, {
           onPress: () => onSelect(item),
           testID: `at-stop-${item.id}`,
           accessibilityRole: "button",
           accessibilityLabel: `${item.name}, ${(0, _libAddTicketFare.formatKm)(item.km_marker)}${state.reason === 'inUse' ? `, already the ${otherLabel}` : state.reason === 'inactive' ? ', deactivated on this device' : ''}`
           // Marked, not blocked. The store checks the route and refuses in
           // its own words, and a row that will not take a tap hides that
           // refusal behind a control that looks broken — the driver picks
           // the same terminal twice, nothing happens, and the fare card
           // never says why.
           ,
           style: ({
             pressed
           }: { [key: string]: any }) => [styles.stopRow, state.reason !== null && styles.stopRowMarked, pressed && styles.pressed],
           children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
             style: styles.stopBody,
             children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.stopName,
               numberOfLines: 1,
               children: item.name
             }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.stopSub,
               numberOfLines: 1,
               children: state.reason === 'inUse' ? `already the ${otherLabel}` : state.reason === 'inactive' ? `${(0, _libAddTicketFare.formatKm)(item.km_marker)} · not in service` : `${(0, _libAddTicketFare.formatKm)(item.km_marker)} · on this device`
             })]
           }), state.reason === 'inUse' ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
             style: styles.inUsePill,
             children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.inUseLabel,
               children: "IN USE"
             })
           }) : state.reason === 'inactive' ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
             style: [styles.inUsePill, styles.offServicePill],
             children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
               style: styles.offServiceLabel,
               children: "OFF"
             })
           }) : null]
         });
       },
       ListFooterComponent: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.sheetFootnote,
         children: "A device only carries the barangays its operator configured. A barangay missing from this list is one this bus does not stop at."
       }),
       ListEmptyComponent: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.sheetFootnote,
         children: terminals.length === 0 ? 'No barangays on this device yet.' : `No barangay matches “${query.trim()}”.`
       }),
       showsVerticalScrollIndicator: false
     })]
   });
 }

 /**
  * The rules the fare above is worked out from, in prose.
  *
  * This is where a disputed peso gets settled: the two steps are stated, the
  * reading this screen takes is admitted as this screen's decision rather than
  * the app's, and the two unused column families are named so nobody hunts for
  * a gap that is not there.
  */
 function FareRulesSheet({
   visible,
   rules,
   onClose
 }: { [key: string]: any }) {
   if (!visible) return null;
   return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.Sheet, {
     kind: "rules",
     title: "Fare rules",
     subtitle: "As this device has them",
     onClose: onClose,
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsBottomSheet.DetailCard, {
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Minimum fare",
           value: rules ? (0, _libAddTicketFare.formatPeso)(rules.minimumFareCentavos) : '—'
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Minimum distance",
           value: rules ? (0, _libAddTicketFare.formatKm)(rules.minimumDistanceMilli) : '—'
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Ordinary rate per km",
           value: rules ? (0, _libAddTicketFare.formatRate)(rules.ratePerKmCentavos) : '—'
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Express way rate per km",
           value: rules ? (0, _libAddTicketFare.formatRate)(rules.expressRatePerKmCentavos) : '—'
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Special rate per km",
           value: rules ? (0, _libAddTicketFare.formatRate)(rules.specialRatePerKmCentavos) : '—'
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Special express way rate per km",
           value: rules ? (0, _libAddTicketFare.formatRate)(rules.specialExpressRatePerKmCentavos) : '—'
         })]
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
         style: styles.proseCard,
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
           style: styles.proseTitle,
           accessibilityRole: "header",
           children: "How the fare is worked out"
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
           style: styles.proseText,
           children: "1. The distance between the two barangays is measured, then raised to the minimum distance if it is shorter. That floored distance is the billable distance \u2014 nothing is added to it."
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
           style: styles.proseText,
           children: "2. The billable distance is multiplied by the rate for this road and this fare type, rounded to the cent, and then raised to the minimum fare if it comes out under it."
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
           style: styles.proseText,
           children: "Student, senior and PWD fares all take the special rate, which is a flat per-kilometre figure rather than a discount off the road\u2019s own rate. The express way carries its own special rate, so a concessionaire pays the flat figure for the road being driven. They do not escape the minimum fare: a short discounted hop is still charged the minimum."
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
           style: styles.proseText,
           children: "The two discount percentages on file are already folded into the stored special rate, and the deluxe rate columns are not used in this calculation at all."
         })]
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.Handoff, {
         children: "Fare settings, where all ten of these are edited"
       })]
   });
 }

 /**
  * The confirmation after a commit. The only overlay with a CTA, and it is an
  * outline rather than a second solid primary — the screen behind it still has
  * one.
  */
 function RecordedSheet({
   visible,
   recorded,
   tripNumber,
   tripTotalCentavos,
   tripTicketCount,
   onRecordAnother
 }: { [key: string]: any }) {
   if (!visible || !recorded) return null;
   return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.Sheet, {
     kind: "recorded",
     title: "Ticket recorded",
     subtitle: `Trip #${tripNumber ?? '—'} · ${(0, _libTripTicketsFormat.formatRowStamp)(recorded.recordedAt)}`,
     onClose: onRecordAnother,
     footer: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Pressable, {
       onPress: onRecordAnother,
       testID: "at-record-another",
       accessibilityRole: "button",
       accessibilityLabel: "Record another ticket, keep this route",
       style: ({
         pressed
       }: { [key: string]: any }) => [styles.ghostButton, pressed && styles.pressed],
       children: /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.ghostButtonLabel,
         children: "Record another"
       })
     }),
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsBottomSheet.DetailCard, {
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Boarding point",
           value: recorded.board.name,
           tabular: false
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Destination",
           value: recorded.drop.name,
           tabular: false
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Distance",
           value: (0, _libAddTicketFare.formatKm)(recorded.distanceMilli)
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Billable distance",
           value: `${(0, _libAddTicketFare.formatKm)(recorded.billableMilli)} at ${(0, _libAddTicketFare.formatRate)(recorded.rateCentavos)}`
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Road",
           value: recorded.usesExpressWay ? 'Express way' : 'Ordinary',
           tabular: false
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Fare type",
           value: passengerTypeLabel(recorded.passengerType),
           tabular: false
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Passengers",
           value: `${recorded.quantity} ${recorded.quantity === 1 ? 'passenger' : 'passengers'}`
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Fare per passenger",
           value: (0, _libAddTicketFare.formatPeso)(recorded.perPassengerCentavos)
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Recorded now",
           value: (0, _libTripTicketsFormat.formatRowStamp)(recorded.recordedAt)
         })]
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.View, {
         style: styles.positionCard,
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Text, {
           style: styles.proseTitle,
           accessibilityRole: "header",
           children: ["Trip #", tripNumber ?? '—', " so far"]
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_reactNative.Text, {
           style: styles.positionValue,
           children: [(0, _libAddTicketFare.formatPeso)(tripTotalCentavos), " \xB7 ", tripTicketCount, " ticket", tripTicketCount === 1 ? '' : 's']
         })]
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.proseText,
         children: "The quantity is back to 1 and the route is still filled in, because the next group boards at the same stop."
       })]
   });
 }

 /**
  * A ticket already in the ledger. No CTA — reading a fare is not a write — and
  * the floors that bound it are explained from the numbers stored on the ticket,
  * because a peso read back months later has to be explicable by the fare stored
  * with it rather than by whatever the rules say today.
  */
 function TicketSheet({
   visible,
   ticket,
   trip,
   rules,
   usesExpressWay,
   onClose
 }: { [key: string]: any }) {
   if (!visible || !ticket) return null;
   // A full-trip rider's leg is the trip's own distance. Any other leg was never
   // stored, and the sheet says so instead of borrowing the trip's number.
   let legMilli = trip !== null && ticket.origin_location_snapshot === trip.origin_location_snapshot && ticket.destination_location_snapshot === trip.destination_location_snapshot ? trip.distance_km_milli : null;
   return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.Sheet, {
     kind: "ticket",
     title: `Ticket #${ticket.id}`,
     subtitle: `Recorded ${(0, _libTripTicketsFormat.formatRowStamp)(ticket.created_at)}`,
     onClose: onClose,
     children: [/*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsBottomSheet.DetailCard, {
         children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Boarding point",
           value: ticket.origin_location_snapshot,
           tabular: false
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Destination",
           value: ticket.destination_location_snapshot,
           tabular: false
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Distance",
           value: legMilli === null ? 'not stored with this ticket' : (0, _libAddTicketFare.formatKm)(legMilli)
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Fare type",
           value: passengerTypeLabel(ticket.passenger_type),
           tabular: false
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Passengers",
           value: `${ticket.passenger_quantity} ${ticket.passenger_quantity === 1 ? 'passenger' : 'passengers'}`
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Fare per passenger",
           value: (0, _libAddTicketFare.formatPeso)(ticket.final_fare_per_passenger)
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Total",
           value: (0, _libAddTicketFare.formatPeso)(ticket.total_fare)
         }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.DetailRow, {
           label: "Recorded",
           value: (0, _libTripTicketsFormat.formatRowStamp)(ticket.created_at)
         })]
       }), rules ? /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.proseText,
         children: (0, _libAddTicketFare.ticketFareNote)({
           farePerPassengerCentavos: ticket.final_fare_per_passenger,
           rules,
           distanceMilli: legMilli,
           usesExpressWay
         })
       }) : /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.proseText,
         children: "This device has no fare rules, so this fare cannot be re-derived. It is read from the amount stored with the ticket."
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_componentsBottomSheet.Handoff, {
         children: "Trip tickets, where it sits in the ledger, and the trip total on Trip and Home"
       })]
   });
 }

 /** The one dead end: the trip's own details, then a way to Trip tickets. */
 /** The loading state. Skeleton rows, not a spinner: the shape is already known. */
 function LoadingState() {
   return /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
     testID: "at-rules",
     style: styles.gutter,
     children: /*#__PURE__*/(0, _reactJsxRuntime.jsxs)(_componentsGlassCard.GlassCard, {
       testID: "at-loading",
       style: styles.card,
       children: [/*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
         style: [styles.skeleton, styles.skeletonTitle]
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
         style: [styles.skeleton, styles.skeletonRow, {
           marginTop: (0, _theme.space)(4)
         }]
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
         style: [styles.skeleton, styles.skeletonRow, {
           marginTop: (0, _theme.space)(3.5)
         }]
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.View, {
         style: [styles.skeleton, styles.skeletonBlock, {
           marginTop: (0, _theme.space)(2)
         }]
       }), /*#__PURE__*/(0, _reactJsxRuntime.jsx)(_reactNative.Text, {
         style: styles.hint,
         accessibilityLiveRegion: "polite",
         children: "Reading this trip, its barangays and its fare rules\u2026"
       })]
     })
   });
 }

 // ── Small helpers ────────────────────────────────────────────────────────────

 /** The chip word and the stored key, read together — never one string. */
 function passengerTypeLabel(type: any) {
   return _libAddTicketFare.PASSENGER_TYPES.find(entry => entry.key === type)?.label ?? type;
 }
 const styles = _reactNative.StyleSheet.create({
   screen: {
     flex: 1
   },
   gutter: {
     marginHorizontal: (0, _theme.space)(5),
     marginTop: (0, _theme.space)(5)
   },
   card: {
     marginHorizontal: (0, _theme.space)(5),
     marginTop: (0, _theme.space)(5),
     padding: (0, _theme.space)(5)
   },
   pressed: {
     opacity: 0.88
   },
   column: {
     width: '100%',
     maxWidth: 720,
     alignSelf: 'center'
   },
   sectionLabel: {
     ..._theme.type.labelSmall,
     color: _theme.palette.onSurfaceVariant
   },
   sectionHead: {
     flexDirection: 'row',
     alignItems: 'center',
     justifyContent: 'space-between',
     marginHorizontal: (0, _theme.space)(5),
     marginTop: (0, _theme.space)(5)
   },
   sectionTotal: {
     ..._theme.type.titleMedium,
     color: _theme.palette.onSurface,
     fontVariant: ['tabular-nums']
   },
   // ROUTE
   fieldGroup: {
     gap: (0, _theme.space)(2)
   },
   field: {
     minHeight: 60,
     flexDirection: 'row',
     alignItems: 'center',
     gap: (0, _theme.space)(3),
     paddingHorizontal: (0, _theme.space)(3),
     borderRadius: _theme.radius.large,
     borderWidth: 1,
     borderColor: _theme.palette.outlineVariant,
     backgroundColor: _theme.palette.surfaceContainerLowest
   },
   fieldIcon: {
     width: 36,
     height: 36,
     alignItems: 'center',
     justifyContent: 'center',
     borderRadius: _theme.radius.medium,
     backgroundColor: _theme.palette.tertiaryContainer
   },
   fieldBody: {
     flex: 1,
     minWidth: 0
   },
   fieldLabel: {
     ..._theme.type.labelSmall,
     color: _theme.palette.onSurfaceVariant
   },
   fieldValue: {
     ..._theme.type.titleMedium,
     color: _theme.palette.onSurface
   },
   fieldPlaceholder: {
     ..._theme.type.bodyMedium,
     color: _theme.palette.outline
   },
   leg: {
     flexDirection: 'row',
     alignItems: 'center',
     gap: (0, _theme.space)(2),
     marginTop: (0, _theme.space)(3)
   },
   // The reference's leg is a rule with the distance sitting on its right end,
   // not a border above a line of text: the distance is what joins the two
   // fields, so it lives on the axis that joins them.
   legLine: {
     flex: 1,
     height: 1,
     backgroundColor: _theme.palette.outline
   },
   legText: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant,
     fontVariant: ['tabular-nums']
   },
   legWarning: {
     ..._theme.type.bodySmall,
     color: _theme.palette.error
   },
   // The reference hangs the refusal under the card, not inside it: the card
   // holds the two choices, the sentence below explains why they do not price.
   legWarnBelow: {
     marginHorizontal: (0, _theme.space)(5),
     marginTop: (0, _theme.space)(2)
   },
   // ROAD
   roadRow: {
     flexDirection: 'row',
     gap: (0, _theme.space)(2),
     marginTop: (0, _theme.space)(3)
   },
   roadButton: {
     flex: 1,
     minHeight: 61,
     justifyContent: 'center',
     paddingHorizontal: (0, _theme.space)(3),
     borderRadius: _theme.radius.large,
     borderWidth: 1,
     borderColor: _theme.palette.outlineVariant,
     backgroundColor: _theme.palette.surfaceContainerLowest
   },
   // Clicked = solid: a chosen control inverts to the brand fill, so one
   // orange means one thing on this screen (the reference's .seg-route rule).
   roadButtonActive: {
     backgroundColor: _theme.palette.primarySolid,
     borderColor: _theme.palette.primarySolid,
     borderWidth: 2
   },
   roadTitle: {
     ..._theme.type.titleMedium,
     color: _theme.palette.onSurface
   },
   roadTitleActive: {
     color: _theme.palette.onPrimary
   },
   roadSub: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant
   },
   roadSubActive: {
     color: _theme.palette.onPrimary
   },
   note: {
     marginTop: (0, _theme.space)(3),
     padding: (0, _theme.space)(3),
     borderRadius: _theme.radius.medium,
     backgroundColor: _theme.palette.secondaryContainer
   },
   noteText: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSecondaryContainer
   },
   // PASSENGERS
   // Four category pills sharing the card's full width on one line. Content-sized
   // chips left a ragged right edge and, at a large font scale, wrapped and ate
   // the space under the card; an equal share cannot do either.
   chipRow: {
     flexDirection: 'row',
     gap: (0, _theme.space)(2),
     marginTop: (0, _theme.space)(3)
   },
   chip: {
     flex: 1,
     minWidth: 0,
     minHeight: 44,
     paddingHorizontal: (0, _theme.space)(1.5),
     alignItems: 'center',
     justifyContent: 'center',
     borderRadius: _theme.radius.full,
     borderWidth: 1,
     borderColor: _theme.palette.outline
   },
   chipSelected: {
     backgroundColor: _theme.palette.primarySolid,
     borderColor: _theme.palette.primarySolid,
     borderWidth: 2
   },
   chipLabel: {
     ..._theme.type.labelSmall,
     color: _theme.palette.onSurfaceVariant
   },
   chipLabelSelected: {
     color: _theme.palette.onPrimary
   },
   stepper: {
     flexDirection: 'row',
     alignItems: 'center',
     justifyContent: 'space-between',
     marginTop: (0, _theme.space)(4)
   },   stepperButton: {
     width: 48,
     height: 48,
     alignItems: 'center',
     justifyContent: 'center',
     borderRadius: _theme.radius.full,
     borderWidth: 1,
     borderColor: _theme.palette.primarySolid,
     backgroundColor: _theme.palette.primarySolid
   },
   // .8, not .4: the glyph and its fill composite under opacity, and .8 is the
   // floor that clears 3:1 on the orange fill (the reference's own rule).
   stepperButtonDisabled: {
     opacity: 0.8
   },
   stepperGlyph: {
     ..._theme.type.titleMedium,
     color: _theme.palette.onPrimary
   },
   stepperValue: {
     ..._theme.type.titleMedium,
     color: _theme.palette.onSurface,
     fontVariant: ['tabular-nums']
   },
   // FARE — the one amber card. Never GlassCard: a translucent tint over the
   // blur would wash the amber fill to pastel.
   fareCard: {
     marginHorizontal: (0, _theme.space)(5),
     marginTop: (0, _theme.space)(5),
     padding: (0, _theme.space)(5),
     borderRadius: _theme.radius.glass,
     backgroundColor: _theme.palette.secondary,
     ..._theme.cardShadow
   },
   fareLabel: {
     ..._theme.type.labelSmall,
     color: _theme.onAmber.primary
   },
   fareRulesAction: {
     flexDirection: 'row',
     alignItems: 'center',
     gap: (0, _theme.space)(1),
     minHeight: 44,
     marginTop: (0, _theme.space)(3)
   },
   fareRulesActionLabel: {
     ..._theme.type.labelSmall,
     color: _theme.onAmber.primary
   },
   fareSub: {
     ..._theme.type.bodySmall,
     color: _theme.onAmber.muted,
     marginTop: 2
   },
   fareRoute: {
     ..._theme.type.headlineSmall,
     color: _theme.onAmber.muted,
     marginTop: (0, _theme.space)(3)
   },
   calc: {
     marginTop: (0, _theme.space)(4),
     paddingTop: (0, _theme.space)(4),
     borderTopWidth: 1,
     borderTopColor: 'rgba(61, 46, 0, 0.25)'
   },
   calcRow: {
     flexDirection: 'row',
     alignItems: 'center',
     justifyContent: 'space-between',
     gap: (0, _theme.space)(3),
     paddingVertical: (0, _theme.space)(2)
   },
   calcLabel: {
     ..._theme.type.bodySmall,
     color: _theme.onAmber.detail,
     flexShrink: 1
   },
   calcValue: {
     ..._theme.type.bodyMedium,
     color: _theme.onAmber.primary,
     fontVariant: ['tabular-nums']
   },
   sumRow: {
     flexDirection: 'row',
     alignItems: 'center',
     justifyContent: 'space-between',
     gap: (0, _theme.space)(3),
     marginTop: (0, _theme.space)(2),
     paddingTop: (0, _theme.space)(3),
     minHeight: 57,
     borderTopWidth: 1,
     borderTopColor: 'rgba(61, 46, 0, 0.25)'
   },
   sumLabel: {
     ..._theme.type.labelLarge,
     color: _theme.onAmber.primary,
     flexShrink: 1
   },
   sumValue: {
     ..._theme.type.displaySmall,
    
color: _theme.onAmber.muted,
    fontVariant: ['tabular-nums']
   },
   fareNote: {
     ..._theme.type.bodySmall,
     color: _theme.onAmber.muted,
     marginTop: (0, _theme.space)(3)
   },
   // COMMIT
   solidButton: {
     minHeight: 48,
     alignItems: 'center',
     justifyContent: 'center',
     paddingHorizontal: (0, _theme.space)(4),
     borderRadius: _theme.radius.large,
     // Solid orange. This one had no fill at all after the glass sweep, so the
     // white label floated on the page background.
     backgroundColor: _theme.palette.primarySolid
   },
   solidButtonDisabled: {
     opacity: 0.45
   },
   solidButtonLabel: {
     ..._theme.type.labelLarge,
     color: '#FFFFFF'
   },
   ghostButton: {
     minHeight: 48,
     alignItems: 'center',
     justifyContent: 'center',
     marginTop: (0, _theme.space)(3),
     paddingHorizontal: (0, _theme.space)(4),
     borderRadius: _theme.radius.large,
     borderWidth: 1,
     borderColor: _theme.palette.outline
   },
   ghostButtonLabel: {
     ..._theme.type.labelLarge,
     color: _theme.palette.onSurface
   },
   blockReason: {
     ..._theme.type.bodySmall,
     color: _theme.palette.error,
     marginTop: (0, _theme.space)(2)
   },
   hint: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant,
     marginTop: (0, _theme.space)(2)
   },
   // RECENT
   recentSection: {
     marginTop: (0, _theme.space)(5)
   },
   // The reference's `.list` inherits its 20px gutters from the `.readable`
   // column around it; the app's column is unpadded and every other block here
   // carries its own `marginHorizontal`, so the list has to as well. The rows
   // below already own the 12px between them via `recentRow.marginBottom`.
   recentList: {
     marginTop: (0, _theme.space)(3),
     marginHorizontal: (0, _theme.space)(5)
   },
   recentRow: {
     flexDirection: 'row',
     alignItems: 'flex-start',
     gap: (0, _theme.space)(3),
     marginBottom: (0, _theme.space)(3),
     padding: (0, _theme.space)(5)
   },
   recentBody: {
     flex: 1,
     minWidth: 0
   },
   recentRoute: {
     ..._theme.type.titleMedium,
     color: _theme.palette.onSurface
   },
   recentMeta: {
     flexDirection: 'row',
     alignItems: 'center',
     flexWrap: 'wrap',
     gap: (0, _theme.space)(1.5),
     marginTop: (0, _theme.space)(1)
   },
   recentMetaText: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant,
     flexShrink: 1
   },
   // The fare-type chip the ledger rows wear: regular takes the pale primary
   // container, the three discounted types take the tertiary one — the same
   // .cat pairs Trip tickets renders.
   recentCat: {
     paddingHorizontal: (0, _theme.space)(2),
     paddingVertical: 2,
     borderRadius: _theme.radius.full
   },
   recentCatRegular: {
     backgroundColor: _theme.palette.primaryContainer,
     color: _theme.palette.onPrimaryContainer
   },
   recentCatDiscount: {
     backgroundColor: _theme.palette.tertiaryContainer,
     color: _theme.palette.onTertiaryContainer
   },
   recentSide: {
     alignItems: 'flex-end'
   },
   recentAmount: {
     ..._theme.type.titleMedium,
     color: _theme.palette.onSurface,
     fontVariant: ['tabular-nums']
   },
   recentId: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant,
     marginTop: (0, _theme.space)(1),
     fontVariant: ['tabular-nums']
   },
   capLine: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant,
     marginHorizontal: (0, _theme.space)(5),
     marginTop: (0, _theme.space)(1)
   },
   emptyCard: {
     padding: (0, _theme.space)(5)
   },
   // `.storage { margin-top: 20px; padding: 12px 20px; display: flex; align-items: center; gap: 8px }`
   storageCard: {
     flexDirection: 'row',
     alignItems: 'center',
     gap: (0, _theme.space)(2),
     marginTop: (0, _theme.space)(5),
     marginHorizontal: (0, _theme.space)(5),
     paddingVertical: (0, _theme.space)(3),
     paddingHorizontal: (0, _theme.space)(5)
   },
   storageNote: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant,
     flex: 1
   },
   // States
   stateCard: {
     padding: (0, _theme.space)(5)
   },
   errorCard: {
     backgroundColor: _theme.palette.errorContainer,
     borderWidth: 1,
     borderColor: _theme.palette.error
   },
   stateTitle: {
     ..._theme.type.titleMedium,
     color: _theme.palette.onSurface
   },
   stateBody: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant,
     marginTop: (0, _theme.space)(2)
   },
   skeleton: {
     borderRadius: _theme.radius.small,
     backgroundColor: _theme.palette.surfaceContainer
   },
   skeletonTitle: {
     height: 16,
     width: 96
   },
   skeletonRow: {
     height: 56
   },
   skeletonBlock: {
     height: 96
   },
   // Every vertical value on the 4px scale.
   handoff: {
     marginTop: (0, _theme.space)(3),
     padding: (0, _theme.space)(3),
     borderRadius: _theme.radius.medium,
     borderWidth: 1,
     borderStyle: 'dashed',
     borderColor: _theme.palette.outlineVariant,
     backgroundColor: _theme.palette.surfaceContainerLow
   },
   // Sheets
   sheet: {
     // minHeight 0 on the body is what lets a long list scroll inside the sheet
     // instead of pushing the sheet past the screen.
     maxHeight: '86%',
     backgroundColor: _theme.palette.surfaceContainerLowest,
     borderTopLeftRadius: _theme.radius.glass,
     borderTopRightRadius: _theme.radius.glass,
     paddingHorizontal: (0, _theme.space)(5),
     paddingTop: (0, _theme.space)(3),
     paddingBottom: (0, _theme.space)(5)
   },
   grabber: {
     width: 36,
     height: 4,
     borderRadius: _theme.radius.full,
     backgroundColor: _theme.palette.outlineVariant,
     alignSelf: 'center',
     marginBottom: (0, _theme.space)(3)
   },
   sheetClose: {
     width: 44,
     height: 44,
     alignItems: 'center',
     justifyContent: 'center',
     borderRadius: _theme.radius.full,
     backgroundColor: _theme.palette.surfaceContainer
   },
   sheetFootnote: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant,
     marginTop: (0, _theme.space)(3)
   },
    search: {
      minHeight: 44,
      paddingHorizontal: (0, _theme.space)(3),
      marginBottom: (0, _theme.space)(3),
      borderRadius: _theme.radius.medium,
      borderWidth: 1,
      borderColor: _theme.palette.outlineVariant,
      color: _theme.palette.onSurface,
      ..._theme.type.bodyMedium
    },
    // The picker list takes the sheet's maxHeight clamp (see BottomSheet):
    // without the shrink it measures full-content, gets clipped by the sheet
    // and cannot scroll on Android.
    sheetList: {
      flexShrink: 1
    },
   stopRow: {
     minHeight: 61,
     flexDirection: 'row',
     alignItems: 'center',
     gap: (0, _theme.space)(2),
     marginBottom: (0, _theme.space)(2),
     paddingVertical: (0, _theme.space)(2),
     paddingHorizontal: (0, _theme.space)(3),
     borderRadius: _theme.radius.medium,
     borderWidth: 1,
     borderColor: _theme.palette.outlineVariant
   },
   stopRowMarked: {
     backgroundColor: _theme.palette.surfaceContainer,
     opacity: 0.7
   },
   stopBody: {
     flex: 1,
     minWidth: 0
   },
   stopName: {
     ..._theme.type.bodyMedium,
     color: _theme.palette.onSurface
   },
   stopSub: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant,
     marginTop: (0, _theme.space)(1),
     fontVariant: ['tabular-nums']
   },
   inUsePill: {
     paddingHorizontal: (0, _theme.space)(2),
     paddingVertical: 2,
     borderRadius: _theme.radius.full,
     backgroundColor: _theme.palette.tertiaryContainer
   },
   inUseLabel: {
     ..._theme.type.labelSmall,
     color: _theme.palette.onTertiaryContainer
   },
   offServicePill: {
     backgroundColor: _theme.palette.errorContainer
   },
   offServiceLabel: {
     ..._theme.type.labelSmall,
     color: _theme.palette.onErrorContainer
   },
   detailCard: {
     paddingVertical: (0, _theme.space)(2),
     borderRadius: _theme.radius.large,
     backgroundColor: _theme.palette.surfaceContainerLow
   },
   detailRow: {
     flexDirection: 'row',
     alignItems: 'center',
     justifyContent: 'space-between',
     gap: (0, _theme.space)(3),
     paddingVertical: (0, _theme.space)(2),
     paddingHorizontal: (0, _theme.space)(3)
   },
   // Every peso and every count lines up in a column.
   proseCard: {
     marginTop: (0, _theme.space)(3),
     padding: (0, _theme.space)(4),
     borderRadius: _theme.radius.large,
     backgroundColor: _theme.palette.surfaceContainerLow
   },
   proseTitle: {
     ..._theme.type.labelSmall,
     color: _theme.palette.onSurfaceVariant
   },
   proseText: {
     ..._theme.type.bodySmall,
     color: _theme.palette.onSurfaceVariant,
     marginTop: (0, _theme.space)(2)
   },
   positionCard: {
     marginTop: (0, _theme.space)(3),
     padding: (0, _theme.space)(4),
     borderRadius: _theme.radius.large,
     backgroundColor: _theme.palette.primaryContainer
   },
   positionValue: {
     ..._theme.type.titleMedium,
     color: _theme.palette.onPrimaryContainer,
     marginTop: (0, _theme.space)(1),
     fontVariant: ['tabular-nums']
   }
 });


export { AddTicketScreen };

