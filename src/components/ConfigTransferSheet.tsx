import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ReturnKeyTypeOptions,
} from 'react-native';
import { GlassCard } from './GlassCard';
import { DetailCard, DetailRow, Sheet } from './BottomSheet';
import { Icon } from '../icons';
import { controlHeight, onPrimarySolid, radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
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
          accessibilityLabel={`Export ${stopsSingular} configuration to a PDF`}
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
          accessibilityLabel={`Import ${stopsSingular} configuration from a PDF`}
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
 * The trigger both screens show BESIDE THEIR SEARCH FIELD.
 *
 * It is measured by `controlHeight` — the same exported constant the search
 * field is — so the two are the same height on every screen and neither can
 * drift from the other. The row around them stretches both, so a search that
 * grows takes the button with it rather than leaving one hovering.
 *
 * `flexShrink: 0` is what keeps a narrow phone honest: the search gives way
 * first and the button never does, so the row shortens instead of wrapping,
 * clipping or pushing the button off the edge.
 *
 * The descriptive second line this carried in the list footer is gone, and
 * with it the `database` icon: a 60pt row beside a search field cannot afford
 * both an icon and a one-line label without squeezing the search down to a few
 * characters on a small phone. The control's height instead buys two stacked
 * lines of the label itself, which is both narrower and easier to read.
 *
 * What the icon used to carry survives in the accessibility label, which still
 * names the registry this acts on, so a screen reader announces what the
 * button does and not merely that it exists.
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
      accessibilityLabel={`Import or export. ${label}`}
      accessibilityHint="Opens a sheet to export this configuration to a PDF, or import one."
      style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
    >
      <GlassCard cornerRadius={radius.large} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <Text style={styles.triggerLine}>IMPORT</Text>
      <Text style={styles.triggerLine}>EXPORT</Text>
    </Pressable>
  );
}

/**
 * The search field and the Import / Export button, side by side, at the top of
 * both Configuration lists.
 *
 * It is ONE component because the user asked for that row to read the same on
 * both screens, and two hand-maintained copies of the same styles is a row that
 * drifts the first time one screen is edited. The geometry lives here, next to
 * the `TransferTrigger` it has to align with, so the search and the button
 * cannot disagree about what height they are.
 *
 * ALIGNMENT IS STRUCTURAL, not tuned: the row stretches both children, so the
 * button is exactly as tall as the search rather than merely centred beside it,
 * and both also declare `controlHeight`. At a narrow width the search gives
 * way — `flex: 1`, with the button `flexShrink: 0` — so a small phone
 * shortens the field instead of wrapping, clipping or overflowing the row.
 *
 * `testID` and `returnKeyType` are optional because the two screens genuinely
 * differ: one labels its field for tests, the other asks the keyboard for its
 * search key. Both are the caller's call, and neither is defaulted into
 * behaviour the other screen never had.
 */
export function ConfigSearchRow({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  transferLabel,
  onOpenTransfer,
  testID,
  returnKeyType,
  transferTestID,
}: {
  /** The current query. The row is controlled; it holds no state of its own. */
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** Announced, and distinct from the placeholder, per screen. */
  accessibilityLabel: string;
  /** The registry's own description, shown to a screen reader on the button. */
  transferLabel: string;
  onOpenTransfer: () => void;
  testID?: string;
  returnKeyType?: ReturnKeyTypeOptions;
  transferTestID: string;
}) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.searchRow}>
      <GlassCard cornerRadius={radius.large} style={[styles.field, styles.fieldSearch]}>
        <View style={styles.fieldIcon}>
          <Icon name="search" size={18} color={theme.accent.tertiary.onContainer} />
        </View>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.palette.outline}
          accessibilityLabel={accessibilityLabel}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType={returnKeyType}
          style={styles.fieldInput}
        />
      </GlassCard>
      <TransferTrigger label={transferLabel} onPress={onOpenTransfer} testID={transferTestID} />
    </View>
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

  // ── the shared search + button row ──
  /**
   * `stretch` rather than `center`: stretch is what makes the two the SAME
   * height instead of both sitting on a shared centre line.
   */
  searchRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space(3),
  },
  /** The search takes the slack; the button beside it does not. */
  fieldSearch: { flex: 1, minWidth: 0 },
  field: {
    minHeight: controlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2),
    paddingHorizontal: 14,
    // The GlassCard child paints the fill and the corner; this keeps it inside
    // them, which is the same reason the scope trigger on the Barangay screen
    // needs it.
    overflow: 'hidden',
    borderRadius: radius.large,
  },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent.tertiary.container,
  },
  fieldInput: { flex: 1, minWidth: 0, padding: 0, ...type.bodyMedium, color: theme.palette.onSurface },

  trigger: {
    // COLUMN, not row: the label is two lines, and a row would set them side
    // by side and double the button's width — which is the width the search
    // field beside it needs.
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    // The same constant the search field beside it uses. Two literals in two
    // files is two chances to end up with a bar one row taller than its button.
    minHeight: controlHeight,
    // The search is the side that gives way on a narrow screen; this never does.
    // Measured at ~70px: on a 320pt phone that still leaves the search a usable
    // input, where an icon beside a one-line label left it three characters
    // wide.
    flexShrink: 0,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    overflow: 'hidden',
    borderRadius: radius.large,
    backgroundColor: theme.palette.primarySolid,
  },
  // The label is two stacked lines rather than one long one, which is what the
  // control's own height buys: 2 x 16px sits inside 60px comfortably, and it
  // halves the button's width, which is the width the search needed.
  triggerLine: { ...type.labelSmall, color: onPrimarySolid, textAlign: 'center' },
});
