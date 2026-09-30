import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionChrome } from '../components/SectionChrome';
import { GlassCard } from '../components/GlassCard';
import { LocalStorageCard } from '../components/LocalStorageCard';
import { DetailCard, DetailRow, Sheet } from '../components/BottomSheet';
import { Icon, type IconName } from '../icons';
import {
  maxContentWidth,
  radius,
  space,
  type,
  type Accent,
  type KonduktTheme,
} from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useUpdates } from '../lib/UpdateProvider';

export type SettingsScreenProps = {
  onBack: () => void;
  onOpenFare: () => void;
  onOpenTerminal: () => void;
  onOpenBarangay: () => void;
  onOpenAdvanced: () => void;
};

type ModuleAccent = Extract<Accent, 'primary' | 'tertiary'> | 'error';

type SettingsModule = {
  key: string;
  icon: IconName;
  title: string;
  description: string;
  accentKey: ModuleAccent;
  onPress: () => void;
};

/**
 * The Settings screen.
 *
 * A navigator, nothing more: four module cards that push to their child
 * screens, plus the offline notice. It reads nothing, writes nothing, and
 * loads nothing — no counts, no previews, no configuration values. A card
 * exists to be pushed from, and its description names the destination.
 */
export function SettingsScreen({
  onBack,
  onOpenFare,
  onOpenTerminal,
  onOpenBarangay,
  onOpenAdvanced,
}: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // The OTA update state, owned by the one provider in App.tsx. The card and
  // the "Update available" sheet below are its only surfaces.
  const updates = useUpdates();

  const modules: SettingsModule[] = [
    {
      key: 'fare',
      icon: 'fare',
      title: 'Fare Configuration',
      description:
        'Manage fare rate per kilometer, minimum fare, minimum distance, and passenger discounts.',
      accentKey: 'tertiary',
      onPress: onOpenFare,
    },
    {
      key: 'terminal',
      icon: 'terminal',
      title: 'Terminal Configuration',
      description: 'Add, edit, or manage terminals and their registered KM markers.',
      accentKey: 'primary',
      onPress: onOpenTerminal,
    },
    {
      key: 'barangay',
      icon: 'barangay',
      title: 'Barangay Configuration',
      description:
        'Add, edit, or manage barangays, municipalities, and their registered KM markers.',
      accentKey: 'primary',
      onPress: onOpenBarangay,
    },
    {
      key: 'advanced',
      icon: 'advanced',
      title: 'Advanced Settings',
      description: 'Additional application settings.',
      accentKey: 'error',
      onPress: onOpenAdvanced,
    },
  ];

  return (
    // The outer View paints the theme background; SectionChrome owns the top
    // inset itself, so it must not be applied here as well.
    <View style={styles.screen}>
      <SectionChrome title="Settings" onBack={onBack} insets={insets}>
        <ScrollView
          contentContainerStyle={[
            styles.column,
            { paddingBottom: insets.bottom + space(6) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionHeading} accessibilityRole="header">
            Settings Modules
          </Text>
          {modules.map((module) => (
            <ModuleCard key={module.key} module={module} theme={theme} styles={styles} />
          ))}
          <Text style={styles.sectionHeading} accessibilityRole="header">
            App Updates
          </Text>
          <UpdateCard updates={updates} theme={theme} styles={styles} />
          {updates.dialogOpen ? (
            <UpdateSheet updates={updates} theme={theme} styles={styles} />
          ) : null}
          <LocalStorageCard
            label="OFFLINE STORAGE"
            body="All configurations are saved locally and work offline."
            // Sentence-case label for the reader: the all-caps copy stays
            // visual only, so a screen reader hears words, not a spelled-out
            // acronym.
            accessibilityLabel="Offline storage. All configurations are saved locally and work offline."
            icon="lock"
            tone="muted"
            // The shared card carries the page gutter in its own style; this
            // column owns its insets, so the card sits at the column's width.
            style={styles.offlineCard}
          />
        </ScrollView>
      </SectionChrome>
    </View>
  );
}

/** One module card: icon chip, title + description, chevron. Merged for a11y. */
function ModuleCard({
  module,
  theme,
  styles,
}: {
  module: SettingsModule;
  theme: KonduktTheme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const tone =
    module.accentKey === 'error'
      ? {
          fg: theme.palette.error,
          container: theme.palette.errorContainer,
        }
      : theme.accent[module.accentKey];

  return (
    <GlassCard
      onPress={module.onPress}
      accessible
      accessibilityRole="button"
      // One announcement: "<Title>. <Description>" — the icon and chevron stay
      // invisible to the reader, per the accessibility contract.
      accessibilityLabel={`${module.title}. ${module.description}`}
      style={styles.card}
    >
      <View style={[styles.iconChip, { backgroundColor: tone.container }]}>
        <Icon name={module.icon} size={24} color={tone.fg} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {module.title}
        </Text>
        <Text style={styles.cardDescription} numberOfLines={3}>
          {module.description}
        </Text>
      </View>
      <Icon name="chevron" size={18} color={theme.palette.outline} />
    </GlassCard>
  );
}

/**
 * The update card: what is installed, when we last asked, and the one action.
 * A surface, not a module — it navigates nowhere, it reports and it checks.
 */
function UpdateCard({
  updates,
  theme,
  styles,
}: {
  updates: ReturnType<typeof useUpdates>;
  theme: KonduktTheme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const accent = theme.accent.primary;
  const ready = updates.phase === 'ready';
  const metaParts = [
    updates.runInfo.version ? `Version ${updates.runInfo.version}` : null,
    updates.runInfo.runtimeVersion ? `Runtime ${updates.runInfo.runtimeVersion}` : null,
    updates.runInfo.channel ? `Channel ${updates.runInfo.channel}` : null,
  ].filter((part): part is string => part !== null);

  return (
    <GlassCard style={styles.updateCard}>
      <View style={styles.updateTopRow}>
        <View style={[styles.iconChip, { backgroundColor: accent.container }]}>
          <Icon name="update" size={24} color={accent.fg} />
        </View>
        <View style={styles.updateTopText}>
          <Text style={styles.cardTitle}>App updates</Text>
          <Text
            style={styles.updateStatus}
            accessibilityLiveRegion="polite"
            testID="update-status"
          >
            {updates.statusText}
          </Text>
        </View>
      </View>
      <Text style={styles.updateMeta} testID="update-meta">
        {metaParts.length > 0 ? metaParts.join('  ·  ') : 'Version information unavailable.'}
      </Text>
      <Text style={styles.updateMeta} testID="update-last-check">
        {updates.lastCheckLabel !== null
          ? `Last checked ${updates.lastCheckLabel}`
          : 'No update check yet on this install.'}
      </Text>
      <Pressable
        onPress={ready ? updates.applyReady : updates.checkNow}
        disabled={updates.busy}
        accessibilityRole="button"
        accessibilityLabel={ready ? 'Restart to apply the downloaded update' : 'Check for updates'}
        accessibilityState={{ disabled: updates.busy, busy: updates.busy }}
        testID="update-check"
        style={({ pressed }) => [
          styles.primaryBtn,
          updates.busy && styles.primaryBtnDisabled,
          pressed && !updates.busy && styles.pressed,
        ]}
      >
        <Text style={styles.primaryBtnLabel}>
          {updates.busy
            ? updates.phase === 'downloading'
              ? 'Downloading…'
              : 'Checking…'
            : ready
              ? 'Restart to Update'
              : 'Check for Updates'}
        </Text>
      </Pressable>
    </GlassCard>
  );
}

/** The "Update available" sheet: the only place an update is ever started. */
function UpdateSheet({
  updates,
  theme,
  styles,
}: {
  updates: ReturnType<typeof useUpdates>;
  theme: KonduktTheme;
  styles: ReturnType<typeof makeStyles>;
}) {
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
        A new version of the application is available. It can be downloaded now: the new
        interface, business logic and content are installed over this one, and your trips,
        tickets, history and settings stay on this device. Native Android changes still arrive
        through Google Play.
      </Text>
      <DetailCard>
        <DetailRow label="Installed version" value={updates.runInfo.version ?? '—'} />
        <DetailRow label="Runtime version" value={updates.runInfo.runtimeVersion ?? '—'} />
        <DetailRow label="Update channel" value={updates.runInfo.channel ?? 'Not configured'} />
      </DetailCard>
      <Text style={styles.sheetHint} accessibilityLiveRegion="polite">
        {updates.statusText}
      </Text>
    </Sheet>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.palette.background },

    column: {
      width: '100%',
      // Home's readable-width token, not the spec's 600: the content-width
      // wrapper is an element type Home already owns, and the design-priority
      // rule gives Home's value the tie-break.
      maxWidth: maxContentWidth,
      alignSelf: 'center',
      paddingHorizontal: space(4),
      paddingTop: space(4),
      gap: space(4),
    },

    sectionHeading: {
      ...type.labelSmall,
      color: theme.palette.onSurfaceVariant,
      // The heading's own rhythm: 4 above, 12 below. The column's 16-unit gap
      // still applies around it, matching the even card rhythm.
      marginTop: space(1),
      marginBottom: space(3),
    },

    // Geometry only: the surface is GlassCard's glass tint, lit rim and shared
    // depth — the reference's `.mod`, not a flat white panel. Press feedback is
    // GlassCard's own fade.
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 104,
      padding: space(4),
      gap: space(3),
    },
    iconChip: {
      width: 48,
      height: 48,
      borderRadius: radius.medium,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardBody: { flex: 1 },
    cardTitle: { ...type.titleMedium, color: theme.palette.onSurface },
    cardDescription: {
      ...type.bodySmall,
      color: theme.palette.onSurfaceVariant,
      marginTop: 2,
    },

    offlineCard: { marginHorizontal: 0, minHeight: 80 },

    // ── update card ────────────────────────────────────────────────────────
    updateCard: {
      padding: space(4),
      gap: space(2),
      minHeight: 0,
    },
    updateTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(3),
    },
    updateTopText: { flex: 1, minWidth: 0 },
    updateStatus: {
      ...type.bodySmall,
      color: theme.palette.onSurfaceVariant,
      marginTop: 2,
    },
    updateMeta: {
      ...type.bodySmall,
      color: theme.palette.outline,
    },
    // The primary action, shaped exactly like the app's other solid buttons
    // (PassengerScreen's Retry/Go-to-trips) so it reads as the same control.
    primaryBtn: {
      marginTop: space(2),
      minHeight: 48,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(2),
      paddingHorizontal: space(5),
      borderRadius: radius.large,
      backgroundColor: theme.palette.primarySolid,
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnLabel: { ...type.labelLarge, color: '#FFFFFF' },
    pressed: { opacity: 0.88 },

    // ── update sheet footer ───────────────────────────────────────────────
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
  });
