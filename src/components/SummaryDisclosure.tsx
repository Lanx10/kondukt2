import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '../icons';
import { accent, glass, palette, radius, space, type, type Accent } from '../theme';
import { GlassCard } from './GlassCard';

/** One figure in the summary detail: a tone chip, a label, a value. */
export type SummaryStat = {
  label: string;
  value: string;
  tone: Accent;
  icon: IconName;
};

/** One passenger category in the breakdown. */
export type SummaryBar = { label: string; count: number };

/**
 * The summary: one hero figure, and everything else behind a disclosure.
 *
 * Shared by the Dashboard and History because the reference gives both the same
 * card — a single number is the answer, and a second screen of equal-weight
 * figures on the same page is what made the old layout read as a table instead
 * of a summary. Collapsed by default for the same reason.
 *
 * `stacked` drops the stat grid to one column, which is what the reference's
 * `body.stack-stats` does below its width or at a large font scale.
 */
export function SummaryDisclosure({
  head,
  caption,
  total,
  meta,
  stats,
  bars,
  loading = false,
  stacked = false,
  glassTiles = false,
}: {
  /** The head line: defaults to the original "TOTAL EARNINGS"; History's
   *  reference appends its scope ("TOTAL EARNINGS TODAY"). */
  head?: string;
  caption: string;
  total: string;
  meta?: string;
  stats: SummaryStat[];
  bars: SummaryBar[];
  loading?: boolean;
  stacked?: boolean;
  /** History's reference draws each stat as a stacked glass tile; Dashboard's
   *  keeps the flat row chip. One card, two tile skins. */
  glassTiles?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const max = Math.max(1, ...bars.map((bar) => bar.count));

  return (
    <View style={styles.root}>
      <GlassCard style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.headLabel}>{head ?? 'TOTAL EARNINGS'}</Text>
          <Pressable
            onPress={() => setOpen((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={open ? 'Hide summary details' : 'Show summary details'}
            accessibilityState={{ expanded: open }}
            hitSlop={8}
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <Text style={styles.linkLabel}>{open ? 'Hide details' : 'Show details'}</Text>
            <Icon name="chevronDown" size={16} color={glass.accentPrimary} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.caption}>{caption}</Text>
          {loading ? <Skeleton height={36} style={styles.skeletonHero} /> : <Text style={styles.total}>{total}</Text>}
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {loading ? <Skeleton height={16} style={styles.skeletonMeta} /> : null}
        </View>

        {open && !loading ? (
          <View style={styles.detail}>
            <View style={[styles.statGrid, stacked && styles.statGridStacked]}>
              {stats.map((stat) => {
                const label = `${stat.label.toLowerCase()}: ${stat.value}`;
                const body = (
                  <>
                    <View
                      style={[styles.statChip, { backgroundColor: accent[stat.tone].container }]}
                    >
                      <Icon name={stat.icon} size={20} color={accent[stat.tone].fg} />
                    </View>
                    <View style={styles.statText}>
                      <Text style={styles.statLabel}>{stat.label}</Text>
                      <Text
                        style={[styles.statValue, glassTiles && styles.statValueStacked]}
                        numberOfLines={1}
                      >
                        {stat.value}
                      </Text>
                    </View>
                  </>
                );
                return glassTiles ? (
                  <GlassCard
                    key={stat.label}
                    style={styles.statTileStacked}
                    accessible
                    accessibilityLabel={label}
                  >
                    {body}
                  </GlassCard>
                ) : (
                  <View
                    key={stat.label}
                    style={styles.statTile}
                    accessible
                    accessibilityLabel={label}
                  >
                    {body}
                  </View>
                );
              })}
            </View>

            <View style={styles.breakdown}>
              <Text style={styles.breakdownTitle}>PASSENGER BREAKDOWN</Text>
              {bars.map((bar, index) => (
                <View
                  key={bar.label}
                  style={[styles.barRow, index > 0 && styles.barRowSpaced]}
                  accessible
                  accessibilityLabel={`${bar.count} ${bar.label.toLowerCase()}`}
                >
                  <Text style={styles.barLabel} numberOfLines={1}>
                    {bar.label}
                  </Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[styles.barFill, { width: `${Math.round((bar.count / max) * 100)}%` }]}
                    />
                  </View>
                  <Text style={styles.barCount}>{bar.count}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </GlassCard>
    </View>
  );
}

/**
 * A loading placeholder. Flat rather than shimmering: the reference's sweep is a
 * CSS animation, and React Native has no animated-background primitive worth the
 * dependency for a state that lasts a few hundred milliseconds.
 */
export function Skeleton({
  height,
  style,
}: {
  height: number;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  return <View style={[styles.skeleton, { height }, style]} />;
}

const styles = StyleSheet.create({
  root: {
    marginTop: space(3),
    marginHorizontal: space(5),
  },
  card: {
    paddingVertical: space(4),
    paddingHorizontal: space(5),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
  },
  headLabel: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
    flex: 1,
  },
  link: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
  },
  // `glass.accentPrimary` (#8F3A00), not `palette.primary` (#E65100 = 3.79:1):
  // an 11px disclosure link is normal text and owes 4.5:1.
  linkLabel: {
    ...type.labelSmall,
    color: glass.accentPrimary,
  },
  pressed: {
    opacity: 0.88,
  },
  hero: {
    marginTop: space(2.5),
  },
  caption: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
  },
  total: {
    ...type.displaySmall,
    color: palette.onSurface,
    marginTop: space(0.5),
    fontVariant: ['tabular-nums'],
  },
  meta: {
    ...type.bodyMedium,
    color: palette.onSurfaceVariant,
    marginTop: space(1.5),
  },
  detail: {
    marginTop: space(4),
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(3),
  },
  statGridStacked: {
    flexDirection: 'column',
  },
  statTile: {
    // Half the row minus the gap: the reference's 1fr 1fr grid.
    width: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2.5),
    paddingVertical: space(3),
    paddingHorizontal: space(3.5),
    borderRadius: radius.medium,
    backgroundColor: palette.surfaceContainerLow,
  },
  // History's tile: a glass card with the icon above the label and value,
  // stacked — the reference's `.glass.stat-tile` column.
  statTileStacked: {
    width: '48%',
    flexGrow: 1,
    padding: space(4),
    gap: space(3),
  },
  statValueStacked: { marginTop: space(1) },
  statChip: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.medium,
  },
  statText: {
    flex: 1,
    minWidth: 0,
  },
  statLabel: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
  },
  statValue: {
    ...type.titleMedium,
    color: palette.onSurface,
    fontVariant: ['tabular-nums'],
  },
  breakdown: {
    marginTop: space(4),
    paddingTop: space(3.5),
    borderTopWidth: 1,
    borderTopColor: palette.outline,
  },
  breakdownTitle: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
    marginBottom: space(2.5),
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
  },
  barRowSpaced: {
    marginTop: space(2),
  },
  barLabel: {
    ...type.bodySmall,
    color: palette.onSurface,
    width: 120,
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: palette.surfaceContainer,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: palette.primarySolid,
  },
  barCount: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    width: 36,
    textAlign: 'right',
  },
  skeleton: {
    borderRadius: radius.medium,
    backgroundColor: 'rgba(120, 130, 150, 0.14)',
  },
  skeletonHero: {
    marginTop: space(2.5),
  },
  skeletonMeta: {
    marginTop: space(2),
  },
});
