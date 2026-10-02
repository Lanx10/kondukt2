import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DetailCard, DetailRow, Sheet } from './BottomSheet';
import { radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useUpdates } from '../lib/UpdateProvider';
import { useApkUpdates } from '../lib/ApkUpdateProvider';
import { formatBytes } from '../lib/apkUpdateState';

/**
 * The update sheets, shared by every screen that surfaces them.
 *
 * The providers mounted in App.tsx own the update state machines;
 * these are their faces. They lived inside SettingsScreen until the
 * Home screen needed the same "Update available" sheet the moment a
 * check finds a release — one component per sheet, so the two
 * surfaces cannot drift apart. The version sheets back the "Version"
 * button on each Settings update card: a read-only panel naming the
 * installed build against its channel's latest version.
 */

/**
 * Which code is on screen right now: the binary's own bundle, or an
 * OTA update that has already been applied. The id is printed short —
 * it is a debugging aid, not a secret, and the full value lives in
 * the logs.
 */
function runningBuildLabel(updates: ReturnType<typeof useUpdates>): string {
  return updates.runInfo.isEmbeddedLaunch
    ? 'Embedded build'
    : updates.runInfo.updateId !== null
      ? `Update ${updates.runInfo.updateId.slice(0, 8)}`
      : 'OTA update';
}

/**
 * The "Update available" / "Update required" sheet: new version, release
 * notes, file size, and the only place a download is ever started. A
 * mandatory release hides "Later" — but the sheet itself can still be
 * dismissed, so an operator is never trapped away from the rest of the
 * app.
 */
export function ApkAvailableSheet({
  apk,
}: {
  apk: ReturnType<typeof useApkUpdates>;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const release = apk.release;
  if (release === null) return null;
  return (
    <Sheet
      kind="apk-update"
      title={apk.mandatory ? 'Update required' : 'Update available'}
      subtitle={`Kondukt ${release.version} is ready to install`}
      onClose={apk.dismissDialog}
      footer={
        <View style={styles.sheetFooter}>
          {apk.mandatory ? null : (
            <Pressable
              onPress={apk.dismissDialog}
              accessibilityRole="button"
              accessibilityLabel="Later"
              testID="apk-update-later"
              style={({ pressed }) => [styles.ghostAction, pressed && styles.pressed]}
            >
              <Text style={styles.ghostActionLabel}>Later</Text>
            </Pressable>
          )}
          <Pressable
            onPress={apk.updateNow}
            disabled={apk.busy}
            accessibilityRole="button"
            accessibilityLabel="Update Now"
            accessibilityState={{ disabled: apk.busy, busy: apk.busy }}
            testID="apk-update-now"
            style={({ pressed }) => [
              styles.solidButton,
              apk.busy && styles.primaryBtnDisabled,
              pressed && !apk.busy && styles.pressed,
            ]}
          >
            <Text style={styles.solidButtonLabel}>
              {apk.busy ? 'Downloading…' : 'Update Now'}
            </Text>
          </Pressable>
        </View>
      }
    >
      <Text style={styles.sheetBodyText}>
        {apk.mandatory
          ? 'This version is required — Kondukt cannot keep running on the installed version. The update downloads over your trips, tickets, history and settings, which all stay on this device.'
          : 'A new version of Kondukt is available. It downloads now and installs through Android’s normal installer; your trips, tickets, history and settings stay on this device.'}
      </Text>
      {release.releaseNotes.length > 0 ? (
        <View style={styles.releaseNotes}>
          {release.releaseNotes.map((note) => (
            <Text key={note} style={styles.releaseNote}>
              •  {note}
            </Text>
          ))}
        </View>
      ) : null}
      <DetailCard>
        <DetailRow label="Installed version" value={apk.installedVersion ?? '—'} />
        <DetailRow label="New version" value={release.version} />
        <DetailRow label="File size" value={formatBytes(release.sizeBytes ?? -1)} />
        <DetailRow label="Release tag" value={release.tag} />
      </DetailCard>
      <Text style={styles.sheetHint} accessibilityLiveRegion="polite">
        {apk.statusText}
      </Text>
    </Sheet>
  );
}

/**
 * The "Installation permission required" sheet: Android needs the user to
 * allow installs from this source before the system prompt will appear. The
 * button opens exactly that settings screen; granting stays in Android's
 * hands — nothing is auto-granted here.
 */
export function ApkPermissionSheet({
  apk,
}: {
  apk: ReturnType<typeof useApkUpdates>;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Sheet
      kind="apk-permission"
      title="Installation permission required"
      subtitle="Android needs permission to install the update"
      onClose={apk.dismissPermission}
      footer={
        <View style={styles.sheetFooter}>
          <Pressable
            onPress={apk.dismissPermission}
            accessibilityRole="button"
            accessibilityLabel="Later"
            testID="apk-permission-later"
            style={({ pressed }) => [styles.ghostAction, pressed && styles.pressed]}
          >
            <Text style={styles.ghostActionLabel}>Later</Text>
          </Pressable>
          <Pressable
            onPress={apk.openPermissionSettings}
            accessibilityRole="button"
            accessibilityLabel="Open Settings"
            testID="apk-permission-settings"
            style={({ pressed }) => [styles.solidButton, pressed && styles.pressed]}
          >
            <Text style={styles.solidButtonLabel}>Open Settings</Text>
          </Pressable>
        </View>
      }
    >
      <Text style={styles.sheetBodyText}>
        Because Kondukt is installed outside Google Play, Android asks you to allow installs
        from this app first. Tap Open Settings, turn on “Install from this source”, then come
        back and tap Install Update. The downloaded update waits for you.
      </Text>
      <Text style={styles.sheetHint} accessibilityLiveRegion="polite">
        {apk.statusText}
      </Text>
    </Sheet>
  );
}

/** The "Update available" sheet: the only place an OTA update is ever started. */
export function UpdateSheet({
  updates,
}: {
  updates: ReturnType<typeof useUpdates>;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Sheet
      kind="update"
      title="Update available"
      subtitle="A new version of Kondukt is ready"
      onClose={updates.dismissDialog}
      footer={
        <View style={styles.sheetFooter}>
          <Pressable
            onPress={updates.dismissDialog}
            accessibilityRole="button"
            accessibilityLabel="Later"
            testID="update-later"
            style={({ pressed }) => [styles.ghostAction, pressed && styles.pressed]}
          >
            <Text style={styles.ghostActionLabel}>Later</Text>
          </Pressable>
          <Pressable
            onPress={updates.downloadAndApply}
            disabled={updates.busy}
            accessibilityRole="button"
            accessibilityLabel="Update Now"
            accessibilityState={{ disabled: updates.busy, busy: updates.busy }}
            testID="update-now"
            style={({ pressed }) => [
              styles.solidButton,
              updates.busy && styles.primaryBtnDisabled,
              pressed && !updates.busy && styles.pressed,
            ]}
          >
            <Text style={styles.solidButtonLabel}>
              {updates.phase === 'downloading' ? 'Downloading…' : 'Update Now'}
            </Text>
          </Pressable>
        </View>
      }
    >
      <Text style={styles.sheetBodyText}>
        A new version of the interface is available. It can be downloaded now: the new
        interface, business logic and content are installed over this one, and your trips,
        tickets, history and settings stay on this device. New Android binaries arrive as
        app updates from GitHub Releases — see App updates above.
      </Text>
      <DetailCard>
        <DetailRow label="Installed version" value={updates.runInfo.version ?? '—'} />
        <DetailRow label="Runtime version" value={updates.runInfo.runtimeVersion ?? '—'} />
        <DetailRow label="Update channel" value={updates.runInfo.channel ?? 'Not configured'} />
        <DetailRow label="Running" value={runningBuildLabel(updates)} />
      </DetailCard>
      <Text style={styles.sheetHint} accessibilityLiveRegion="polite">
        {updates.statusText}
      </Text>
    </Sheet>
  );
}

/**
 * The APK card's "Version" sheet: the installed build against the newest
 * release the updater has seen — readable even when nothing newer exists,
 * which is exactly when the card has nothing else to say about versions.
 */
export function ApkVersionSheet({
  apk,
  onClose,
}: {
  apk: ReturnType<typeof useApkUpdates>;
  onClose: () => void;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Sheet
      kind="apk-version"
      title="App version"
      subtitle="Installed build and latest release"
      onClose={onClose}
      footer={
        <View style={styles.sheetFooter}>
          <Pressable
            onPress={apk.checkNow}
            disabled={apk.busy}
            accessibilityRole="button"
            accessibilityLabel="Check for updates"
            accessibilityState={{ disabled: apk.busy, busy: apk.busy }}
            testID="apk-version-check"
            style={({ pressed }) => [
              styles.solidButton,
              apk.busy && styles.primaryBtnDisabled,
              pressed && !apk.busy && styles.pressed,
            ]}
          >
            <Text style={styles.solidButtonLabel}>
              {apk.busy ? 'Checking…' : 'Check for Updates'}
            </Text>
          </Pressable>
        </View>
      }
    >
      <Text style={styles.sheetBodyText}>
        The version installed on this device, and the newest release published on GitHub
        Releases. When the newest release is newer than the installed build, the App
        updates card downloads and installs it.
      </Text>
      <DetailCard>
        <DetailRow label="Installed version" value={apk.installedVersion ?? '—'} />
        <DetailRow
          label="Latest release"
          value={
            apk.latestVersion ??
            (apk.lastCheckAt !== null ? 'Unavailable' : 'Not checked yet')
          }
        />
        <DetailRow label="Last checked" value={apk.lastCheckLabel ?? '—'} />
      </DetailCard>
      {/* The change log, read from the same release the rows above name. It is
          the notes of the newest release a check has seen rather than of the
          release waiting to install, so it is here when the install already
          matches — which is when someone opens this sheet to find out what
          they are running. Nothing invented: an empty list prints a sentence
          instead, and never a "no changes" claim the publisher did not make. */}
      <Text style={styles.changelogHeading}>
        {apk.latestVersion !== null ? `What's new in ${apk.latestVersion}` : 'Change log'}
      </Text>
      {apk.latestReleaseNotes.length > 0 ? (
        <View style={styles.releaseNotes}>
          {apk.latestReleaseNotes.map((note) => (
            <Text key={note} style={styles.releaseNote}>
              •  {note}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.sheetHint}>
          {apk.latestVersion !== null
            ? 'This release was published without any notes.'
            : 'No release has been checked for on this install yet, so there is nothing to read here.'}
        </Text>
      )}
      <Text style={styles.sheetHint} accessibilityLiveRegion="polite">
        {apk.statusText}
      </Text>
    </Sheet>
  );
}

/**
 * The interface-updates card's "Version" sheet: the build running on this
 * device. OTA updates carry no version number of their own — expo-updates
 * identifies them by update id — so the sheet says so plainly rather than
 * inventing a figure, and points new binaries at the APK channel.
 */
export function UpdateVersionSheet({
  updates,
  onClose,
}: {
  updates: ReturnType<typeof useUpdates>;
  onClose: () => void;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Sheet
      kind="update-version"
      title="Interface version"
      subtitle="The version running on this device"
      onClose={onClose}
      footer={
        <View style={styles.sheetFooter}>
          <Pressable
            onPress={updates.checkNow}
            disabled={updates.busy}
            accessibilityRole="button"
            accessibilityLabel="Check for updates"
            accessibilityState={{ disabled: updates.busy, busy: updates.busy }}
            testID="update-version-check"
            style={({ pressed }) => [
              styles.solidButton,
              updates.busy && styles.primaryBtnDisabled,
              pressed && !updates.busy && styles.pressed,
            ]}
          >
            <Text style={styles.solidButtonLabel}>
              {updates.busy ? 'Checking…' : 'Check for Updates'}
            </Text>
          </Pressable>
        </View>
      }
    >
      <Text style={styles.sheetBodyText}>
        Interface updates are delivered over the air and carry no version number of their
        own — the version below is the app build that ships them. New Android binaries
        arrive as app updates from GitHub Releases — see App updates above.
      </Text>
      <DetailCard>
        <DetailRow label="Installed version" value={updates.runInfo.version ?? '—'} />
        <DetailRow label="Runtime version" value={updates.runInfo.runtimeVersion ?? '—'} />
        <DetailRow label="Update channel" value={updates.runInfo.channel ?? 'Not configured'} />
        <DetailRow label="Running" value={runningBuildLabel(updates)} />
        <DetailRow label="Last checked" value={updates.lastCheckLabel ?? '—'} />
      </DetailCard>
      <Text style={styles.sheetHint} accessibilityLiveRegion="polite">
        {updates.statusText}
      </Text>
    </Sheet>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
    pressed: { opacity: 0.88 },
    primaryBtnDisabled: { opacity: 0.5 },

    // ── update sheet footer ───────────────────────────────────────────
    sheetFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: space(2),
      marginTop: space(4),
    },
    ghostAction: {
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: space(3),
      borderRadius: radius.large,
    },
    ghostActionLabel: { ...type.labelLarge, color: theme.palette.onSurfaceVariant },
    solidButton: {
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: space(5),
      borderRadius: radius.large,
      backgroundColor: theme.palette.primarySolid,
    },
    solidButtonLabel: { ...type.labelLarge, color: '#FFFFFF' },
    sheetBodyText: {
      ...type.bodyMedium,
      color: theme.palette.onSurface,
    },
    sheetHint: {
      ...type.bodySmall,
      color: theme.palette.onSurfaceVariant,
      marginTop: space(3),
    },

    // The change log's own heading. Label-size and on-surface, so it reads as
    // a title for the list under it rather than another line of body copy.
    changelogHeading: {
      ...type.labelLarge,
      color: theme.palette.onSurface,
      marginTop: space(4),
      marginBottom: space(1),
    },

    // Release notes in the APK sheet: a simple bulleted list on the sheet's
    // own body rhythm — no new surface, just text.
    releaseNotes: {
      marginTop: space(3),
      gap: space(1),
    },
    releaseNote: {
      ...type.bodySmall,
      color: theme.palette.onSurfaceVariant,
    },
  });
