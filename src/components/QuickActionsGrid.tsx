import { StyleSheet, Text, View } from 'react-native';
import { GlassCard } from './GlassCard';
import { Icon, IconName } from '../icons';
import { Accent, accent, glass, radius, space, type } from '../theme';

export type QuickAction = {
  key: string;
  icon: IconName;
  title: string;
  subtitle: string;
  accent: Accent;
  onPress: () => void;
};

/**
 * One card in the home grid.
 *
 * These were the app's only opaque panels: white fill, `outlineVariant` border,
 * while every neighbouring card on the page (the hero's aside, the last-trip
 * card, the storage note, every ledger row) was glass. Seven white rectangles
 * in the middle of a glass stack is what made the page read as two designs, so
 * the surface is now the shared `GlassCard` and the ink comes from the glass
 * tokens — `onGlass` / `onGlassVariant` / `accentPrimary` — which are the ones
 * chosen to clear 4.5:1 against a *tinted* panel rather than against white.
 *
 * The card keeps its own grid geometry (min height, padding, the 2-column cell
 * it sits in); only the paint moved.
 */
function QuickActionCard({ action, compact }: { action: QuickAction; compact: boolean }) {
  const tone = accent[action.accent];
  return (
    <GlassCard
      onPress={action.onPress}
      cornerRadius={radius.glass}
      accessibilityRole="button"
      accessibilityLabel={action.title}
      accessibilityHint={action.subtitle}
      style={[styles.card, compact && styles.cardCompact]}
    >
      <View style={[styles.iconContainer, { backgroundColor: tone.container }]}>
        <Icon name={action.icon} size={24} color={tone.fg} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {action.title}
      </Text>
      <Text style={styles.subtitle} numberOfLines={3}>
        {action.subtitle}
      </Text>
      <View style={styles.chevron}>
        <Icon name="chevron" size={16} color={glass.accentPrimary} />
      </View>
    </GlassCard>
  );
}

export function QuickActionsGrid({
  actions,
  compact,
}: {
  actions: QuickAction[];
  compact: boolean;
}) {
  return (
    <View style={styles.grid}>
      {actions.map((action) => (
        <View key={action.key} style={styles.cell}>
          <QuickActionCard action={action} compact={compact} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // 14 + 6 cell padding = 20, so card edges line up with the hero and heading.
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: space(3.5) },
  cell: { width: '50%', padding: space(1.5) },
  // No fill and no border of its own: the glass supplies the tint, the lit rim
  // and the shadow, so a second border here would double the edge.
  card: {
    minHeight: 152,
    padding: space(4),
    borderRadius: radius.glass,
  },
  // Narrow screens get a taller card rather than clipped or truncated text.
  cardCompact: { minHeight: 184 },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...type.titleMedium, color: glass.onGlass, marginTop: space(3) },
  subtitle: { ...type.bodySmall, color: glass.onGlassVariant, marginTop: space(1), flex: 1 },
  chevron: { alignSelf: 'flex-end', marginTop: space(2) },
});
