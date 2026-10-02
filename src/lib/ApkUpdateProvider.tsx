/**
 * The APK update provider: owns the GitHub Releases update state machine —
 * check, notify, download, verify, install — plus the automatic lifecycle
 * (one throttled check at start, one per return to foreground) and the
 * sheets' open state.
 *
 * This is the app's PRIMARY update mechanism: Google Play is not used, and
 * EAS Update (the sibling `UpdateProvider`) is a secondary channel for
 * JS-only changes — never a replacement for installing a new APK. One
 * provider for the whole app — mounted once in App.tsx — so there is exactly
 * one APK updater. Settings reads it through `useApkUpdates()`; no screen
 * touches the service directly.
 *
 * Safety rules encoded here:
 *  - Automatic checks never open a sheet while a transaction screen is
 *    mounted (see updateGuard) and never download: the Settings card carries
 *    the news until the operator asks.
 *  - Automatic check failures are logged and swallowed: an offline device
 *    must not see update errors at launch (offline-first rule). Only a
 *    manual check from Settings produces error copy.
 *  - Downloads are single-flight; returning to the foreground mid-flow never
 *    restarts or interrupts a download, and the installer only ever launches
 *    after `verifyApk` passed.
 *  - Never touches the SQLite database or app state: installing the APK
 *    replaces the binary and Android keeps `kondukt.db` untouched.
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
import type { File } from 'expo-file-system';
import { formatDate, formatTime } from './format';
import { isUpdateBlocked } from './updateGuard';
import {
  loadLastApkUpdateCheck,
  saveLastApkUpdateCheck,
  loadCachedApkRelease,
  saveCachedApkRelease,
} from './preferences';
import { UPDATE_CONFIG } from './apkUpdateConfig';
import {
  APK_UPDATE_COPY,
  apkStatusText,
  isApkUpdateBusy,
  resolveApkUpdate,
  shouldApkAutoCheck,
  type ApkErrorKind,
  type ApkProgress,
  type ApkRelease,
  type ApkUpdatePhase,
} from './apkUpdateState';
import {
  ApkUpdateError,
  downloadApk,
  fetchLatestRelease,
  getInstalledVersion,
  getInstalledVersionCode,
  installApk,
  openUnknownSourcesSettings,
  verifyApk,
} from './apkUpdateService';

export type ApkUpdateContextValue = {
  /** The current phase — drives the Settings card's status line. */
  phase: ApkUpdatePhase;
  /** The classified failure behind an `error` (or install hiccup), else null. */
  error: ApkErrorKind | null;
  /** The friendly status sentence for the current phase/error/progress. */
  statusText: string;
  /** The checked release waiting to be installed, or null. */
  release: ApkRelease | null;
  /** True when the install is below the release's `minimumVersion`. */
  mandatory: boolean;
  /** Live download progress, or null outside a download. */
  progress: ApkProgress | null;
  /** This install's version, for the card's meta line. */
  installedVersion: string | null;
  /** When any check was last attempted (epoch ms), or null. */
  lastCheckAt: number | null;
  /** "Sep 30, 2026 · 3:42 PM" of the last attempt, or null. */
  lastCheckLabel: string | null;
  /** True while a check/download/verify/install is running. */
  busy: boolean;
  /** True while the "Update available" / "Update required" sheet shows. */
  dialogOpen: boolean;
  /** True while the "Installation permission required" sheet shows. */
  permissionOpen: boolean;
  /** The newest release version any check has seen, or null. */
  latestVersion: string | null;
  /**
   * That same release's notes — its change log — tracked across every valid
   * verdict rather than only while an update waits. `release` is null when
   * this install already matches the newest release, which is exactly the
   * moment a driver opens the version sheet to read what changed, so the
   * notes have to outlive the "an update is available" state. Empty when no
   * check has seen a release, or when the manifest carried none.
   */
  latestReleaseNotes: string[];
  /** Manual check from Settings. Resolves when the check settles. */
  checkNow: () => Promise<void>;
  /** The available sheet's "Update Now": download, verify, launch installer. */
  updateNow: () => Promise<void>;
  /** The card's button while a verified file waits: launch the installer. */
  installNow: () => Promise<void>;
  /** The permission sheet's "Open Settings": unknown-sources screen. */
  openPermissionSettings: () => Promise<void>;
  /** The available sheet's "Later" / scrim dismiss. */
  dismissDialog: () => void;
  /** The permission sheet's dismiss. */
  dismissPermission: () => void;
};

const ApkUpdateContext = createContext<ApkUpdateContextValue | null>(null);

/**
 * Consumes the APK update state. Throws when used outside the provider — the
 * provider wraps the whole app, so this is a programming error, not a
 * runtime condition to paper over.
 */
export function useApkUpdates(): ApkUpdateContextValue {
  const value = useContext(ApkUpdateContext);
  if (value === null) {
    throw new Error('useApkUpdates must be used inside <ApkUpdateProvider>');
  }
  return value;
}

export function ApkUpdateProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<ApkUpdatePhase>('idle');
  const [error, setError] = useState<ApkErrorKind | null>(null);
  const [release, setRelease] = useState<ApkRelease | null>(null);
  const [mandatory, setMandatory] = useState(false);
  const [progress, setProgress] = useState<ApkProgress | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  // The newest release any check has seen — tracked even when this
  // install already matches it, so the version sheet can name the
  // latest release whether or not it is new.
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  // Its notes, for the same reason and on the same terms as the version above.
  const [latestReleaseNotes, setLatestReleaseNotes] = useState<string[]>([]);
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);

  // The verified file waiting for the installer; not state (never rendered).
  const pendingFileRef = useRef<File | null>(null);
  // Mirror of `phase` for lifecycle callbacks that must not re-render just to
  // read it (the AppState handler and the auto-check's clobber guard).
  const phaseRef = useRef<ApkUpdatePhase>('idle');
  /** Single writer for the phase: keeps state and ref in lockstep. */
  const goPhase = useCallback((next: ApkUpdatePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  // One flow at a time: a second tap, a foreground event racing a manual
  // check, or a re-entrant install joins instead of stacking.
  const flowBusyRef = useRef(false);

  /** Records the attempt (throttle + the Settings "last checked" line). */
  const recordAttempt = useCallback(async () => {
    const at = Date.now();
    await saveLastApkUpdateCheck(at);
    setLastCheckAt(at);
  }, []);

  /** Classifies any thrown error into the state machine's error bucket. */
  const captureError = useCallback((caught: unknown, fallback: ApkErrorKind) => {
    const kind = caught instanceof ApkUpdateError ? caught.kind : fallback;
    setError(kind);
    return kind;
  }, []);

  /**
   * Applies a check's verdict to the state machine. Returns whether an
   * update is waiting.
   */
  const applyVerdict = useCallback((found: ApkRelease): boolean => {
    const verdict = resolveApkUpdate(
      { version: getInstalledVersion(), versionCode: getInstalledVersionCode() },
      found,
      { allowMandatoryUpdates: UPDATE_CONFIG.allowMandatoryUpdates },
    );
    if (verdict === 'invalid') {
      // Malformed installed or released version: not an update, not a crash.
      goPhase('uptodate');
      return false;
    }
    // The newest release seen, tracked across every valid verdict —
    // the version sheet names it and lists its notes even when
    // nothing newer exists.
    setLatestVersion(found.version);
    setLatestReleaseNotes(found.releaseNotes);
    // Cached so the change log survives the restart that follows this check,
    // and the throttle window that follows it. A failed write is not an error:
    // the notes are already on screen, and the next check will try again.
    void saveCachedApkRelease({ version: found.version, notes: found.releaseNotes });
    if (verdict === 'uptodate') {
      setRelease(null);
      setMandatory(false);
      goPhase('uptodate');
      return false;
    }
    setRelease(found);
    setMandatory(verdict === 'mandatory');
    goPhase('available');
    return true;
  }, [goPhase]);

  /**
   * The automatic check: throttled, silent, never raising error state, and
   * never downloading. Skips itself while a flow is in flight or while a
   * transaction screen is mounted (no sheet over a half-entered ticket).
   */
  const autoCheck = useCallback(async () => {
    if (flowBusyRef.current) return;
    const last = await loadLastApkUpdateCheck();
    if (!shouldApkAutoCheck(last, Date.now(), UPDATE_CONFIG.automaticCheckIntervalMs)) {
      return;
    }
    flowBusyRef.current = true;
    try {
      await recordAttempt();
      const found = await fetchLatestRelease();
      // Never clobber a download/verify/install in flight (or its verified
      // file waiting on the installer) with a fresh verdict.
      const busyPhase = phaseRef.current;
      if (
        busyPhase === 'downloading' ||
        busyPhase === 'verifying' ||
        busyPhase === 'ready' ||
        busyPhase === 'installing' ||
        busyPhase === 'permission'
      ) {
        return;
      }
      const hasUpdate = applyVerdict(found);
      if (hasUpdate && !isUpdateBlocked()) setDialogOpen(true);
      console.info(`[apk-update] auto → ${hasUpdate ? 'update available' : 'up to date'}`);
    } catch (caught) {
      // Offline-first: log and carry on. No error banner at launch, and no
      // error state to clobber a flow that is already running — the card
      // simply keeps whatever state it had.
      const kind = caught instanceof ApkUpdateError ? caught.kind : 'server';
      console.info(`[apk-update] auto check skipped (${kind})`);
    } finally {
      flowBusyRef.current = false;
    }
  }, [applyVerdict, recordAttempt]);

  // Start-up check + a throttled check whenever the app returns to the
  // foreground. One listener, mounted once.
  useEffect(() => {
    void Promise.resolve().then(autoCheck);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Returning from Android's installer or the settings screen: if a
      // verified file was mid-install, hand control back to the user with an
      // Install button instead of guessing whether the prompt was accepted.
      const current = phaseRef.current;
      if (
        (current === 'installing' || current === 'permission') &&
        pendingFileRef.current !== null
      ) {
        phaseRef.current = 'ready';
        setPermissionOpen(false);
        setPhase('ready');
      }
      void Promise.resolve().then(autoCheck);
    });
    void loadLastApkUpdateCheck().then((at) => {
      if (at !== null) setLastCheckAt(at);
    });
    // The release the last check found, restored so the version sheet's change
    // log is populated on launch. The six-hour throttle means a fresh check is
    // usually not waiting, and a change log that reads "nothing checked yet" on
    // every launch answers none of the question it was opened for.
    void loadCachedApkRelease().then((cached) => {
      if (cached === null) return;
      setLatestVersion((current) => current ?? cached.version);
      setLatestReleaseNotes((current) => (current.length > 0 ? current : cached.notes));
    });
    return () => subscription.remove();
  }, [autoCheck]);

  /** Manual check from Settings. The throttle does not apply — user asked. */
  const checkNow = useCallback(async () => {
    if (flowBusyRef.current) return;
    flowBusyRef.current = true;
    setError(null);
    setPermissionOpen(false);
    try {
      goPhase('checking');
      await recordAttempt();
      const found = await fetchLatestRelease();
      const hasUpdate = applyVerdict(found);
      if (hasUpdate) {
        if (isUpdateBlocked()) {
          // Transaction screen mounted: news lives on the card only.
          setDialogOpen(false);
        } else {
          setDialogOpen(true);
        }
      } else {
        setDialogOpen(false);
      }
    } catch (caught) {
      captureError(caught, 'server');
      goPhase('error');
    } finally {
      flowBusyRef.current = false;
    }
  }, [applyVerdict, captureError, goPhase, recordAttempt]);

  /** Runs the installer against the verified file; classifies failures. */
  const launchInstaller = useCallback(async (): Promise<boolean> => {
    const file = pendingFileRef.current;
    const found = release;
    if (file === null || found === null) return false;
    goPhase('installing');
    setError(null);
    try {
      await installApk(file, found);
      // The system prompt is now up; AppState's 'active' handler returns us
      // to `ready` when the user comes back (installed or cancelled).
      return true;
    } catch (caught) {
      const kind = captureError(caught, 'install');
      if (kind === 'permission') {
        goPhase('permission');
        setPermissionOpen(true);
      } else if (kind === 'verify') {
        // File stopped matching the checked release: drop it; re-download.
        pendingFileRef.current = null;
        goPhase('available');
      } else {
        goPhase('ready');
      }
      return false;
    }
  }, [captureError, goPhase, release]);

  /**
   * "Update Now": download → verify → launch the installer. Single-flight;
   * the sheet closes first so the card can carry the progress. A failure at
   * any step lands on friendly copy and leaves the app fully usable.
   */
  const updateNow = useCallback(async () => {
    if (flowBusyRef.current) return;
    const found = release;
    if (found === null) return;
    flowBusyRef.current = true;
    setDialogOpen(false);
    setPermissionOpen(false);
    setError(null);
    setProgress(null);
    try {
      goPhase('downloading');
      const file = await downloadApk(found, (received, total) => {
        setProgress({ received, total });
      });
      goPhase('verifying');
      await verifyApk(file, found);
      pendingFileRef.current = file;
      setProgress(null);
      await launchInstaller();
    } catch (caught) {
      setProgress(null);
      const kind = captureError(caught, 'download');
      // Keep the release so "Update Now" stays one tap away on the card.
      goPhase(kind === 'permission' ? 'permission' : 'error');
      if (kind === 'permission') setPermissionOpen(true);
    } finally {
      flowBusyRef.current = false;
    }
  }, [captureError, goPhase, launchInstaller, release]);

  /** The card's button while a verified file waits: launch the installer. */
  const installNow = useCallback(async () => {
    if (flowBusyRef.current) return;
    if (pendingFileRef.current === null) return;
    flowBusyRef.current = true;
    try {
      await launchInstaller();
    } finally {
      flowBusyRef.current = false;
    }
  }, [launchInstaller]);

  /** The permission sheet's "Open Settings": unknown-sources screen. */
  const openPermissionSettings = useCallback(async () => {
    try {
      await openUnknownSourcesSettings();
      setPermissionOpen(false);
      // On return, the AppState handler flips `permission` → `ready` so the
      // card offers Install again; the user re-granted (or not) in Android.
    } catch (caught) {
      captureError(caught, 'install');
      setPermissionOpen(false);
    }
  }, [captureError]);

  const dismissDialog = useCallback(() => setDialogOpen(false), []);
  const dismissPermission = useCallback(() => setPermissionOpen(false), []);

  const busy = isApkUpdateBusy(phase);
  const statusText =
    // A mandatory release overrides the plain "available" sentence.
    mandatory && phase === 'available'
      ? APK_UPDATE_COPY.required
      : apkStatusText(phase, error, progress);
  const installedVersion = useMemo(() => getInstalledVersion(), []);
  const lastCheckLabel = useMemo(() => {
    if (lastCheckAt === null) return null;
    const date = new Date(lastCheckAt);
    return `${formatDate(date)} · ${formatTime(date)}`;
  }, [lastCheckAt]);

  const value = useMemo<ApkUpdateContextValue>(
    () => ({
      phase,
      error,
      statusText,
      release,
      mandatory,
      progress,
      installedVersion,
      lastCheckAt,
      lastCheckLabel,
      busy,
      dialogOpen,
      permissionOpen,
      latestVersion,
      latestReleaseNotes,
      checkNow,
      updateNow,
      installNow,
      openPermissionSettings,
      dismissDialog,
      dismissPermission,
    }),
    [
      phase,
      error,
      statusText,
      release,
      mandatory,
      progress,
      installedVersion,
      lastCheckAt,
      lastCheckLabel,
      busy,
      dialogOpen,
      permissionOpen,
      latestVersion,
      latestReleaseNotes,
      checkNow,
      updateNow,
      installNow,
      openPermissionSettings,
      dismissDialog,
      dismissPermission,
    ],
  );

  return <ApkUpdateContext.Provider value={value}>{children}</ApkUpdateContext.Provider>;
}
