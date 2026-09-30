/**
 * The update provider: owns the OTA check/download/apply state machine, the
 * automatic lifecycle (one throttled check at start, one per return to
 * foreground), and the "Update available" sheet's open state.
 *
 * One provider for the whole app — mounted once in App.tsx — so there is
 * exactly one update checker. Screens read through `useUpdates()`; none of
 * them touch expo-updates directly.
 *
 * Safety rules encoded here:
 *  - Automatic checks never open a sheet while a transaction screen is
 *    mounted (see updateGuard) and NEVER restart the app. A restart happens
 *    only from an explicit "Update Now" / "Restart to apply" press.
 *  - Automatic check failures are logged and swallowed: an offline device
 *    must not see error banners at launch (offline-first rule). Only a
 *    manual check from Settings produces error copy.
 *  - Every state has an escape: no update, failed check, failed download and
 *    a disabled build all leave the app fully usable.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { formatDate, formatTime } from './format';
import { isUpdateBlocked } from './updateGuard';
import { loadLastUpdateCheck, saveLastUpdateCheck } from './preferences';
import {
  applyUpdate,
  checkForUpdate,
  downloadUpdate,
  getRunInfo,
  isOtaEnabled,
  UpdateError,
  type RunInfo,
} from './updateService';
import {
  autoCheckFailureNote,
  checkLogLine,
  shouldAutoCheck,
  updateStatusText,
  type UpdateErrorKind,
  type UpdatePhase,
} from './updateState';

export type UpdateContextValue = {
  /** The current phase — drives the Settings card's status line. */
  phase: UpdatePhase;
  /** The classified failure behind an `error` phase, else null. */
  error: UpdateErrorKind | null;
  /** The friendly status sentence for the current phase/error. */
  statusText: string;
  /** Version / runtime / channel of the running install. */
  runInfo: RunInfo;
  /** When any check was last attempted (epoch ms), or null. */
  lastCheckAt: number | null;
  /** "Sep 30, 2026 · 3:42 PM" of the last attempt, or null. */
  lastCheckLabel: string | null;
  /** True while a check or download is running. */
  busy: boolean;
  /** True while the "Update available" sheet should be shown. */
  dialogOpen: boolean;
  /** Manual check from Settings. Resolves when the check settles. */
  checkNow: () => Promise<void>;
  /** The sheet's "Update Now": download, then restart into the update. */
  downloadAndApply: () => Promise<void>;
  /** The card's button while `phase === 'ready'`: restart into it. */
  applyReady: () => Promise<void>;
  /** The sheet's "Later" / scrim dismiss. */
  dismissDialog: () => void;
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

/**
 * Consumes the update state. Throws when used outside the provider — the
 * provider wraps the whole app, so this is a programming error, not a
 * runtime condition to paper over.
 */
export function useUpdates(): UpdateContextValue {
  const value = useContext(UpdateContext);
  if (value === null) {
    throw new Error('useUpdates must be used inside <UpdateProvider>');
  }
  return value;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [error, setError] = useState<UpdateErrorKind | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);

  // The run info is immutable for the life of a launch; read once.
  const runInfo = useMemo(() => getRunInfo(), []);

  // One flow at a time: a second tap, or a foreground event racing a manual
  // check, joins instead of stacking. The service has its own single flight
  // for each network call; this guards the state machine around them.
  const flowBusyRef = useRef(false);

  /** Records the attempt (throttle + the Settings "last checked" line). */
  const recordAttempt = useCallback(async () => {
    const at = Date.now();
    await saveLastUpdateCheck(at);
    setLastCheckAt(at);
  }, []);

  /**
   * The automatic check: throttled, silent, and never raising error state.
   * Skips itself while a flow is in flight, while a transaction screen is
   * mounted (no sheet over a half-entered ticket), or when OTA is off.
   */
  const autoCheck = useCallback(async () => {
    if (flowBusyRef.current) return;
    if (!isOtaEnabled()) return;
    const last = await loadLastUpdateCheck();
    if (!shouldAutoCheck(last, Date.now())) return;
    flowBusyRef.current = true;
    try {
      await recordAttempt();
      const available = await checkForUpdate();
      if (available) {
        setPhase('available');
        // No sheet over an in-progress transaction — the Settings card
        // carries the news until the operator asks for it.
        if (!isUpdateBlocked()) setDialogOpen(true);
      } else {
        // Leave an in-progress or ready flow alone; only a settled screen
        // moves on to "you're up to date".
        setPhase((current) =>
          current === 'idle' || current === 'error' ? 'uptodate' : current,
        );
      }
      console.info(checkLogLine(available ? 'available' : 'unavailable'));
    } catch (caught) {
      // Offline-first: log and carry on. No error banner at launch.
      const kind = caught instanceof UpdateError ? caught.kind : 'server';
      console.info(autoCheckFailureNote(kind));
    } finally {
      flowBusyRef.current = false;
    }
  }, [recordAttempt]);

  // Start-up check + a throttled check whenever the app returns to the
  // foreground. One listener, mounted once; `shouldAutoCheck` keeps the
  // cadence honest across both triggers and across restarts.
  useEffect(() => {
    // Deferred through a microtask, like every other load in this app: the
    // effect body subscribes, the callback (never the body itself) updates
    // React state.
    void Promise.resolve().then(autoCheck);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void Promise.resolve().then(autoCheck);
    });
    void loadLastUpdateCheck().then((at) => {
      if (at !== null) setLastCheckAt(at);
    });
    return () => subscription.remove();
  }, [autoCheck]);

  const checkNow = useCallback(async () => {
    if (flowBusyRef.current) return;
    flowBusyRef.current = true;
    setError(null);
    try {
      if (!isOtaEnabled()) {
        setPhase('disabled');
        return;
      }
      setPhase('checking');
      await recordAttempt();
      const available = await checkForUpdate();
      if (available) {
        setPhase('available');
        setDialogOpen(true);
      } else {
        setPhase('uptodate');
      }
    } catch (caught) {
      const kind = caught instanceof UpdateError ? caught.kind : 'server';
      setPhase('error');
      setError(kind);
    } finally {
      flowBusyRef.current = false;
    }
  }, [recordAttempt]);

  /**
   * "Update Now": download, then restart into the update. The restart only
   * ever happens on this explicit press — and this press can only come from
   * Settings, where no transaction screen is mounted. A download failure
   * lands on friendly copy; a failed restart leaves the downloaded update to
   * run on the next cold start (phase `ready`).
   */
  const downloadAndApply = useCallback(async () => {
    if (flowBusyRef.current) return;
    flowBusyRef.current = true;
    setDialogOpen(false);
    setError(null);
    try {
      if (!isOtaEnabled()) {
        setPhase('disabled');
        return;
      }
      setPhase('downloading');
      await downloadUpdate();
      setPhase('ready');
      if (isUpdateBlocked()) return; // deferred by the guard — restart later
      try {
        await applyUpdate();
        // reloadAsync resolves only after verification; reaching here means
        // the restart did not take, so the card offers it again.
      } catch {
        setPhase('ready');
        setError('apply');
      }
    } catch (caught) {
      const kind = caught instanceof UpdateError ? caught.kind : 'download';
      setPhase('error');
      setError(kind);
    } finally {
      flowBusyRef.current = false;
    }
  }, []);

  /** The card's button while an update waits: restart into it now. */
  const applyReady = useCallback(async () => {
    if (flowBusyRef.current) return;
    flowBusyRef.current = true;
    setError(null);
    try {
      await applyUpdate();
    } catch {
      setPhase('ready');
      setError('apply');
    } finally {
      flowBusyRef.current = false;
    }
  }, []);

  const dismissDialog = useCallback(() => setDialogOpen(false), []);

  const busy = phase === 'checking' || phase === 'downloading';
  const lastCheckLabel = useMemo(() => {
    if (lastCheckAt === null) return null;
    const date = new Date(lastCheckAt);
    return `${formatDate(date)} · ${formatTime(date)}`;
  }, [lastCheckAt]);

  const value = useMemo<UpdateContextValue>(
    () => ({
      phase,
      error,
      statusText: updateStatusText(phase, error),
      runInfo,
      lastCheckAt,
      lastCheckLabel,
      busy,
      dialogOpen,
      checkNow,
      downloadAndApply,
      applyReady,
      dismissDialog,
    }),
    [
      phase,
      error,
      runInfo,
      lastCheckAt,
      lastCheckLabel,
      busy,
      dialogOpen,
      checkNow,
      downloadAndApply,
      applyReady,
      dismissDialog,
    ],
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}
