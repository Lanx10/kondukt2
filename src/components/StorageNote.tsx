
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../icons';
import { glassBlur, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { GlassCard } from './GlassCard';

/** "1 trip" / "3 trips" — the note's counts, and the footnote's. */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The local-storage note, and the footnote under it.
 *
 * The last thing on both ledgers and the only place either says where the
 * numbers come from. Presentational: the caller supplies the counts, because the
 * Dashboard counts from the live store and History counts from the database, and
 * neither should have to know how the other reads its records.
 */
export function StorageNote({
  tripCount,
  ticketCount,
  dayCount,
  style,
}: {
  tripCount: number;
  ticketCount: number;
  dayCount: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const summary =
    `${plural(tripCount, 'trip')} and ${plural(ticketCount, 'fare')} across ` +
    `${plural(dayCount, 'day')}, all saved on this device. No network is used.`;

  return (
    <View style={[styles.root, style]}>
      <GlassCard
        intensity={glassBlur}
        style={styles.card}
        accessible
        accessibilityLabel={summary}
      >
        <Icon name="database" size={18} color={theme.glass.accentTertiary} />
        <Text style={styles.text}>
          <Text style={styles.strong}>{plural(tripCount, 'trip')}</Text> and{' '}
          <Text style={styles.strong}>{plural(ticketCount, 'fare')}</Text> across{' '}
          <Text style={styles.strong}>{plural(dayCount, 'day')}</Text>, all saved on this device.{' '}
          <Text style={styles.strong}>No network is used.</Text>
        </Text>
      </GlassCard>
      <Text style={styles.footnote}>{'Kondukt \u2014 fares stay on this device.'}</Text>
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  root: {
    marginTop: space(5),
  },
  // The reference's note is icon-plus-paragraph, not the app's labelled card: a
  // bare 18px glyph and one sentence, 16/20 padding, 12px gap.
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    paddingVertical: space(4),
    paddingHorizontal: space(5),
  },
  text: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    flex: 1,
  },
  strong: {
    color: theme.palette.onSurface,
    fontFamily: 'Poppins_600SemiBold',
  },
  // `padding: 16px 0 4px` — the reference keeps 4px under the last line so the
  // footnote does not sit flush on the home indicator.
  footnote: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    textAlign: 'center',
    paddingTop: space(4),
    paddingBottom: space(1),
  },
});
