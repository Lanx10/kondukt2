import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GlassCard } from './GlassCard';
import { DetailCard, DetailRow, Sheet } from './BottomSheet';
import { Icon } from '../icons';
import { onPrimarySolid, radius, space, type, type KonduktTheme } from '../theme';
import { useThemedStyles } from '../lib/useThemedStyles';
import {
  transferIssueLines,
  type TransferIssue,
} from '../lib/transferState';

/**
 * The one Import / Export sheet, shared by both Configuration screens.
 *
 * Two screens, one sheet: a sheet one of them re-declares is a sheet that will
 * drift, which is the reason `BottomSheet.tsx` exists at all. The screens own
 * the DATA (what is in the file, what the store accepts); this owns the
 * PRESENTATION — the two actions, the counts they act on, the busy state and
 * the refusals, all read the same on a phone and a tablet.
 *
 * `fill` is set because the refusals list is the one part of this sheet that
 * can be long: a file with fifty refused rows needs its own scroll, and the
 * fill body's `flexBasis: 'auto'` is what lets it shrink inside the sheet's
 * clamp instead of pushing it off the screen.
 */
export function ConfigTransferSheet({
  sheetTitle,
  subtitle,
  stopsLabel,
  stopsSingular,
  note,
  counts,
  busy,
  notice,
  issues,
  exportedName,
  onExport,
  onImport,
  onClose,
}: {
  /** This registry's own title, from the registry table. */
  sheetTitle: string;
  subtitle: string;
  /** "Barangays on this device" / "Terminals on this device". */
  stopsLabel: string;
  /** The singular, for a sentence about the screen's subject. */
  stopsSingular: string;
  /**
   * What this registry's file does and does not carry. Supplied rather than
   * derived here: it is a sentence of policy, and policy belongs with the
   * registry that has it, not with the renderer that prints it.
   */
  note: string;
  /** What is on this device right now: the two collections' sizes. */
  counts: { municipalities: number; stops: number };
  /** `null` when idle, otherwise which action is running. */
  busy: 'export' | 'import' | null;
  /** The write's one-line answer, or null before anything has happened. */
  notice: string | null;
  /** Everything the import refused, already phrased by `transferState`. */
  issues: TransferIssue[];
  /** Where the last export landed, stated in full so it can be found again. */
  exportedName: string | null;
  onExport: () => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Sheet
      kind="transfer"
      title={sheetTitle}
      subtitle={subtitle}
      onClose={onClose}
      fill
      closeTestID="transfer-sheet-close"
    >
      <ScrollView showsVerticalScrollIndicator={false} testID="transfer-scroll">
        {/* What the two actions act on. Read from the live collections, never
            from the file — this states the DEVICE's size, so the user can tell
            a restore into an empty install from one into a full one. */}
        <DetailCard>
          <DetailRow label="Municipalities on this device" value={String(counts.municipalities)} />
          <DetailRow label={stopsLabel} value={String(counts.stops)} />
        </DetailCard>

        {/* Where the last file went. Stated in full, because a backup the user
            cannot find is not a backup — a bare "saved" answers none of it. */}
        {exportedName !== null ? (
          <View style={styles.pathBox}>
            <Text style={styles.pathLabel}>SAVED ON THIS DEVICE</Text>
            <Text style={styles.pathValue} testID="transfer-path">
              {exportedName}
            </Text>
          </View>
        ) : null}

        {/* The write's answer, or the refusals, in one slot. An error is stated
            as a sentence inside the sheet rather than thrown: a bad file is an
            expected outcome of an import, and the screen behind it never
            changes state on a failure. */}
        {notice !== null ? (
          <GlassCard
            cornerRadius={radius.large}
            style={styles.notice}
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.noticeText} testID="transfer-notice">
              {notice}
            </Text>
          </GlassCard>
        ) : null}

        {issues.length > 0 ? (
          <View style={styles.issueBox} testID="transfer-issues">
            <Text style={styles.issueTitle}>SKIPPED</Text>
            {transferIssueLines(issues).map((line, index) => (
              <Text key={`${index}-${line}`} style={styles.issueLine}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.note}>{note}</Text>
      </ScrollView>

      {/* The two actions in the sheet's footer, in the app's own vocabulary:
          IMPORT takes the primary solid pill and EXPORT is the ghost beside
          it. Primary goes on IMPORT because it is the action that WRITES to
          the registry — the same reasoning as this app's confirm sheet, where
          DEACTIVATE (a write) is the primary and CANCEL is not. EXPORT only
          reads. */}
      <View style={styles.actions}>
        <Pressable
          onPress={onExport}
          disabled={busy !== null}
          testID="transfer-export"
          accessibilityRole="button"
          accessibilityLabel={`Export ${stopsSingular} configuration to a file`}
          accessibilityState={{ disabled: busy !== null, busy: busy === 'export' }}
          style={({ pressed }) => [
            styles.ghost,
            busy !== null && styles.off,
            pressed && busy === null && styles.pressed,
          ]}
        >
          <GlassCard cornerRadius={radius.large} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <Text style={styles.ghostLabel}>{busy === 'export' ? 'Saving…' : 'EXPORT'}</Text>
        </Pressable>
        <Pressable
          onPress={onImport}
          disabled={busy !== null}
          testID="transfer-import"
          accessibilityRole="button"
          accessibilityLabel={`Import ${stopsSingular} configuration from a file`}
          accessibilityState={{ disabled: busy !== null, busy: busy === 'import' }}
          style={({ pressed }) => [
            styles.primary,
            busy !== null && styles.primaryOff,
            pressed && busy === null && styles.pressed,
          ]}
        >
          <Text style={styles.primaryLabel}>{busy === 'import' ? 'Importing…' : 'IMPORT'}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/**
 * The trigger both screens show in their list footer.
 *
 * A row beside the OFFLINE STORAGE card it acts on, not a button in the
 * section head: the head already carries the count and the one ADD pill, and a
 * third control there would make the list's own primary action ambiguous. The
 * icon is the same `database` glyph the Settings screen uses for storage, so
 * the feature reads as "this device's data", which is what it is.
 */
export function TransferTrigger({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
    >
      <GlassCard cornerRadius={radius.large} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={styles.triggerIcon}>
        <Icon name="database" size={18} color={onPrimarySolid} />
      </View>
      <View style={styles.triggerBody}>
        <Text style={styles.triggerLabel}>IMPORT / EXPORT</Text>
        <Text style={styles.triggerSub}>{label}</Text>
      </View>
      <Icon name="chevron" size={18} color={onPrimarySolid} />
    </Pressable>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  pressed: { opacity: 0.88 },
  off: { opacity: 0.5 },
  primaryOff: { opacity: 0.65 },

  pathBox: {
    marginTop: space(4),
    padding: space(3),
    borderRadius: radius.large,
    backgroundColor: theme.palette.surfaceContainerLow,
  },
  pathLabel: { ...type.labelSmall, color: theme.palette.onSurfaceVariant },
  pathValue: {
    ...type.bodySmall,
    color: theme.palette.onSurface,
    marginTop: space(1),
  },

  notice: {
    marginTop: space(4),
    paddingVertical: space(3),
    paddingHorizontal: space(4),
    backgroundColor: theme.palette.surfaceContainerLow,
  },
  noticeText: { ...type.bodySmall, color: theme.palette.onSurface },

  issueBox: {
    marginTop: space(3),
    padding: space(3),
    borderRadius: radius.medium,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.palette.outlineVariant,
  },
  issueTitle: { ...type.labelSmall, color: theme.palette.onSurfaceVariant },
  issueLine: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(1) },

  note: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(4) },

  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: space(3),
    marginTop: space(4),
  },
  ghost: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space(3),
    overflow: 'hidden',
    borderRadius: radius.large,
  },
  ghostLabel: { ...type.labelLarge, color: theme.palette.onSurfaceVariant },
  primary: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(5),
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  primaryLabel: { ...type.labelLarge, color: onPrimarySolid },

  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    marginTop: space(5),
    paddingVertical: space(3),
    paddingHorizontal: space(4),
    overflow: 'hidden',
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  triggerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
    // Translucent white, not the solid fill: the icon already sits ON the
    // solid pill, so a `primarySolid` tile at any opacity is invisible.
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  triggerBody: { flex: 1, minWidth: 0 },
  triggerLabel: { ...type.labelSmall, color: onPrimarySolid },
  triggerSub: { ...type.bodySmall, color: onPrimarySolid, marginTop: 2, opacity: 0.9 },
});
