import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../icons';
import { glass, palette, space, type } from '../theme';

/** Below this the action wraps under the title rather than squeezing it. */
const STACK_HEADER_WIDTH = 360;

/**
 * Section header, generalised from the Home Screen's `QUICK ACTIONS` heading.
 *
 * Home had a label and nothing else. The Dashboard needs a label plus a
 * trailing action — `VIEW HISTORY`, `OPEN HISTORY` — and the two must look
 * identical, so this is that heading with an optional right-hand slot rather
 * than a second heading component.
 *
 * The action is a text button rather than a filled one: these sit on a page
 * that already has a primary action, and a second filled button per section
 * would out-shout the number the section is actually about.
 */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
  width,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  width: number;
}) {
  const stacked = width < STACK_HEADER_WIDTH;

  return (
    <View style={[styles.root, stacked && styles.rootStacked]}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          // 48 is the minimum touch target. The label is 11px and would
          // otherwise present a ~16px hit area.
          hitSlop={16}
          style={({ pressed }) => [styles.action, stacked && styles.actionStacked, pressed && styles.pressed]}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
          <Icon name="chevron" size={14} color={glass.accentPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space(5),
    marginBottom: space(3),
    marginHorizontal: space(5),
  },
  // On a narrow screen the action drops below the title and right-aligns,
  // rather than the title wrapping to two lines beside a shrinking action.
  rootStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  title: { ...type.labelSmall, color: palette.onSurfaceVariant },
  action: { flexDirection: 'row', alignItems: 'center', gap: space(1), minHeight: 48 },
  actionStacked: { alignSelf: 'flex-end', marginTop: -space(2) },
  // The reference's `.link-btn`: 12px/600 in `--glass-primary`. Not
  // `labelSmall` (11px) and not `palette.primary` (#E65100 = 3.79:1, short of
  // the 4.5:1 a 12px label owes).
  actionLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 12, lineHeight: 18, color: glass.accentPrimary },
  pressed: { opacity: 0.7 },
});

export { STACK_HEADER_WIDTH };
