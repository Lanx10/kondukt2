import { type ReactNode } from 'react';
import { StyleSheet, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Icon } from '../icons';
import { radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

/**
 * The standard scrim and bottom sheet, shared by the screens that end in one.
 *
 * Two of them now do — Add ticket's six overlays and Add trip's five — and a
 * sheet that one of them re-declares is a sheet that will drift. One component,
 * one scrim, one grabber, one close control, one testID convention.
 *
 * Focus is captured on open and returned on close by the Modal itself, and the
 * hardware back button closes through `onRequestClose`, which is the same path
 * the close button takes. The sheet is its own responder inside the scrim, so a
 * press on the sheet's own padding is not a press on the scrim behind it.
 */
export function Sheet({
  kind,
  title,
  subtitle,
  onClose,
  children,
  footer,
  fill = false,
  closeTestID,
}: {
  /** Names the sheet's testID: `at-${kind}-sheet`. */
  kind: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the body, e.g. a primary action. */
  footer?: ReactNode;
  /** Grow the body to the sheet's full height instead of hugging its content. */
  fill?: boolean;
  /** Overrides the default `at-${kind}-close` for a screen with its own convention. */
  closeTestID?: string;
}) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} testID={`at-${kind}-sheet`}>
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <View style={styles.sheetHeadText}>
              <Text style={styles.sheetTitle} accessibilityRole="header">
                {title}
              </Text>
              {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable
              onPress={onClose}
              testID={closeTestID ?? `at-${kind}-close`}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}
            >
              <Icon name="close" size={18} color={theme.palette.onSurface} />
            </Pressable>
          </View>
          <View style={[styles.sheetBody, fill && styles.sheetBodyFill]}>
            {/* Non-fill bodies scroll inside the sheet's clamp. Android's Yoga
                does not shrink a child that lacks `flexShrink` when the sheet's
                `maxHeight` bites, so raw children would overflow the sheet and
                be clipped with no way to reach them; the scroll takes the
                shrink instead and bounds itself, so a short body still hugs its
                content and a long one scrolls. Fill bodies keep their children
                direct — each picker list owns its own scroll. */}
            {fill ? (
              children
            ) : (
              <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
                {children}
              </ScrollView>
            )}
          </View>
          {footer}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * A label/value line, the shape every detail sheet reads in.
 *
 * `tabular` defaults on because nearly every value in these sheets is a peso, a
 * kilometre or a count, and a column that does not line up reads as noise.
 */
export function DetailRow({
  label,
  value,
  tabular = true,
}: {
  label: string;
  value: ReactNode;
  tabular?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, tabular && styles.tabular]}>{value}</Text>
    </View>
  );
}

/**
 * The handoff: a dashed block naming the screen that owns whatever the driver
 * has just discovered they cannot change here.
 *
 * Prose, not a button. A read-only screen whose escape hatch is a route the app
 * does not have is a dead button, and one that says where to go is not.
 */
export function Handoff({
  children,
  testID = 'at-handoff',
}: {
  children: string | string[];
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const text = Array.isArray(children) ? children.join(' ') : children;
  return (
    <View
      style={styles.handoff}
      testID={testID}
      accessible
      accessibilityLabel={`Where this is changed. ${text}`}
    >
      <Text style={styles.handoffText}>{text}</Text>
    </View>
  );
}

/** A group of `DetailRow`s, the sheet-level card they sit in. */
export function DetailCard({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.detailCard}>{children}</View>;
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  pressed: { opacity: 0.88 },
  scrim: {
    flex: 1,
    backgroundColor: theme.palette.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    // The body below carries minHeight 0 and flexShrink, which is what lets a
    // long list scroll inside the sheet instead of pushing it past the screen.
    maxHeight: '86%',
    backgroundColor: theme.palette.surfaceContainerLowest,
    borderTopLeftRadius: radius.glass,
    borderTopRightRadius: radius.glass,
    paddingHorizontal: space(5),
    paddingTop: space(3),
    paddingBottom: space(5),
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: theme.palette.outlineVariant,
    alignSelf: 'center',
    marginBottom: space(3),
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
  },
  sheetHeadText: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    ...type.headlineSmall,
    color: theme.palette.onSurface,
  },
  sheetSubtitle: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginTop: space(1),
  },
  sheetClose: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: theme.palette.surfaceContainer,
  },
  sheetBody: {
    marginTop: space(4),
    minHeight: 0,
    flexShrink: 1,
  },
  /**
   * The `fill` body.
   *
   * NOT `flex: 1`: that shorthand sets `flexBasis: 0`, and this sheet's height
   * is its content (capped by `maxHeight`). Android's Yoga then has no definite
   * height to grow into and collapses the body to zero — a picker sheet that
   * renders its title and none of its rows, which is exactly how Add Barangay's
   * municipality list broke on a real phone (the browser's CSS stretches the
   * same tree, so it looked fine there). `flexBasis: 'auto'` keeps the body at
   * its children's height, so a short list hugs its content and a long one is
   * bounded by the sheet's `maxHeight` and then scrolls (the body shrinks, and
   * each picker's ScrollView shrinks with it).
   */
  sheetBodyFill: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
  },
  // The non-fill body's scroll: `flexShrink` is the whole trick — it lets the
  // scroll absorb the sheet's `maxHeight` clamp where a plain child would not.
  sheetScroll: {
    flexShrink: 1,
  },
  detailCard: {
    paddingVertical: space(2),
    borderRadius: radius.large,
    backgroundColor: theme.palette.surfaceContainerLow,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(3),
    paddingVertical: space(2),
    paddingHorizontal: space(3),
  },
  detailLabel: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
  },
  detailValue: {
    ...type.bodySmall,
    color: theme.palette.onSurface,
    flexShrink: 1,
    textAlign: 'right',
  },
  // Every peso and every count lines up in a column.
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  handoff: {
    marginTop: space(3),
    padding: space(3),
    borderRadius: radius.medium,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.palette.outlineVariant,
    backgroundColor: theme.palette.surfaceContainerLow,
  },
  handoffText: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
  },
});
