
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { space, type, type KonduktTheme } from '../../theme';

import { useThemedStyles } from '../../lib/useThemedStyles';
import { useKonduktTheme } from '../../lib/themeContext';
import { GlassCard } from '../GlassCard';
import type { LastCompletedTrip } from '../../data/historyStore';
import { formatShortTime } from '../../lib/tripScreenFormat';
import { centavos } from '../../lib/tripTicketsFormat';

/** "1 fare" / "3 fares" — a count and its noun never disagree in number. */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The last completed run, one level below the hero.
 *
 * Only rendered when a trip has ended and none is running — the answer to "what
 * did I do last?" is a card, not a figure, and it disappears the moment a new
 * trip starts because then the hero is the more useful answer.
 */
export function LastTripCard({
  trip,
  onOpenHistory,
}: {
  trip: LastCompletedTrip;
  onOpenHistory: () => void;
}) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const route = `${trip.origin_location_snapshot} → ${trip.destination_location_snapshot}`;
  const summary =
    `Ended ${formatShortTime(trip.ended_at)} · ${plural(trip.ticket_count, 'fare')} · ` +
    plural(trip.passenger_count, 'passenger');

  return (
    <View style={styles.root}>
      <Text style={styles.label} accessibilityRole="header">
        LAST TRIP
      </Text>
      <GlassCard
        intensity={theme.glass.blur}
        style={styles.card}
        accessible
        accessibilityLabel={`Last trip. ${route}. ${summary}. ${centavos(trip.earnings)} collected.`}
      >
        <View style={styles.main}>
          <Text style={styles.route} numberOfLines={2}>
            {route}
          </Text>
          <Text style={styles.sub}>{summary}</Text>
        </View>
        <View style={styles.side}>
          <Text style={styles.total} numberOfLines={1}>
            {centavos(trip.earnings)}
          </Text>
          <Pressable
            onPress={onOpenHistory}
            accessibilityRole="button"
            accessibilityLabel="View all trips in History"
            hitSlop={12}
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <Text style={styles.linkLabel}>View all in History</Text>
          </Pressable>
        </View>
      </GlassCard>
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  root: {
    marginTop: space(5),
  },
  label: {
    ...type.labelSmall,
    color: theme.palette.onSurfaceVariant,
    marginBottom: space(2.5),
    marginHorizontal: space(5),
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    marginHorizontal: space(5),
    paddingVertical: space(3.5),
    paddingHorizontal: space(5),
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  route: {
    ...type.titleMedium,
    color: theme.palette.onSurface,
  },
  sub: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginTop: space(0.5),
  },
  side: {
    alignItems: 'flex-end',
    gap: space(0.5),
    flexShrink: 0,
  },
  total: {
    ...type.titleMedium,
    color: theme.palette.onSurface,
    fontVariant: ['tabular-nums'],
  },
  link: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
  },
  // 4.5:1, not `theme.palette.primary`'s 3.79:1 — see SectionHeader.actionLabel.
  linkLabel: {
    ...type.labelSmall,
    color: theme.glass.accentPrimary,
  },
  pressed: {
    opacity: 0.7,
  },
});
