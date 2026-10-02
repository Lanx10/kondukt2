
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '../icons';
import { radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { GlassCard } from './GlassCard';

/**
 * The local-storage notice, generalised from the Home screen's card.
 *
 * Every screen shows the same statement, so the label, body and icon came in
 * as props — but the defaults ARE the original strings and the original
 * treatment, so a caller without props renders exactly what Home has always
 * shown. Settings passes its own copy and a muted lock tint per its spec; the
 * tint lives in props rather than a second component, because the card is one
 * idea (records stay on this device) with per-screen wording.
 */
export function LocalStorageCard({
  label = 'LOCAL RECORDS SAVED ON THIS DEVICE',
  body = 'Your data is stored locally and stays on this device.',
  /** Sentence-case override for the reader; defaults to the visual label. */
  accessibilityLabel,
  icon = 'database',
  /** The original card's tertiary treatment; Settings asks for a muted lock. */
  tone = 'tertiary',
  /** Extra styling, e.g. zeroing the page gutter inside a padded column. */
  style,
}: {
  label?: string;
  body?: string;
  accessibilityLabel?: string;
  icon?: IconName;
  tone?: 'tertiary' | 'muted';
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const iconColor = tone === 'muted' ? theme.palette.onSurfaceVariant : theme.accent.tertiary.fg;
  const containerColor =
    tone === 'muted' ? theme.palette.surfaceContainer : theme.accent.tertiary.container;
  const labelColor =
    tone === 'muted' ? theme.palette.onSurfaceVariant : theme.accent.tertiary.onContainer;

  return (
    <GlassCard
      style={[styles.root, style]}
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label}. ${body}`}
    >
      <View style={[styles.iconContainer, { backgroundColor: containerColor }]}>
        <Icon name={icon} size={22} color={iconColor} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: labelColor }]}>{label}</Text>
        <Text style={styles.text}>{body}</Text>
      </View>
    </GlassCard>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  root: {
    flexDirection: 'row',
    // Top-aligned with the reference's note and with `StorageNote`: the chip
    // sits level with the first line instead of floating in a centred block.
    alignItems: 'flex-start',
    // The reference's section rhythm: 20px of air above the footer card, the
    // same space `StorageNote` keeps. Without it the card butts against the
    // last row of the list above it.
    marginTop: space(5),
    marginHorizontal: space(5),
    // 16/20, not 16 all round: with 16 the text column started 4px inside
    // every other card's, so this footer read as a different card.
    paddingVertical: space(4),
    paddingHorizontal: space(5),
    gap: space(3),
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  title: { ...type.labelSmall },
  text: { ...type.bodySmall, color: theme.palette.onSurfaceVariant, marginTop: space(1) },
});
