import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GlassCard } from './GlassCard';
import { Icon, IconName } from '../icons';
import { Accent, glassBlur, radius, space, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';

export type QuickAction = {
  key: string;
  icon: IconName;
  title: string;
  /** The reference's blurb — announced, never rendered under the title. */
  subtitle: string;
  /** The live figure the reference prints in the tile: "₱1,068.00 today". */
  value: string;
  /** The figure's context, announced after it — reference: aria only. */
  extra: string;
  /** Where the tile goes, announced last — reference: "Opens <screen>." */
  opens: string;
  accent: Accent;
  onPress: () => void;
};

/**
 * One card in the home grid — home.html's `.qa-btn`, glass edition.
 *
 * The reference tile is four facts and nothing else: chip, title, the live
 * figure, and the rest in the accessible name. The static subtitle used to
 * print under every title where the reference prints today's number, so the
 * tiles read as menu entries rather than as the day's summary; `value`,
 * `extra` and `opens` were already computed on the screen and dropped on the
 * floor here.
 *
 * Surface: the shared `GlassCard`, frosted with `glassBlur` — the same
 * `blur(18px)` the reference's `.glass` carries — at the reference's 16px
 * corner (not the 28px panel radius: `.qa-btn` overrides `.glass` in the
 * stylesheet) and its 112px floor, 40px chip, 14px padding.
 */
function QuickActionCard({ action }: { action: QuickAction }) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const tone = theme.accent[action.accent];
  // The reference's tone-primary chip ink is `--primary-solid`; the M3 role
  // colour (#E65100) sits at 3.6:1 on the container where solid clears 5.2.
  const chipInk = action.accent === 'primary' ? theme.palette.primarySolid : tone.fg;
  return (
    <GlassCard
      onPress={action.onPress}
      intensity={glassBlur}
      cornerRadius={radius.large}
      accessibilityRole="button"
      accessibilityLabel={`${action.title}. ${action.subtitle}. ${action.value}. ${action.extra}. Opens ${action.opens}.`}
      style={styles.card}
    >
      <View style={[styles.iconContainer, { backgroundColor: tone.container }]}>
        <Icon name={action.icon} size={22} color={chipInk} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {action.title}
      </Text>
      <Text style={styles.value} numberOfLines={1} ellipsizeMode="tail">
        {action.value}
      </Text>
    </GlassCard>
  );
}

export function QuickActionsGrid({ actions }: { actions: QuickAction[] }) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.grid}>
      {actions.map((action) => (
        <View key={action.key} style={styles.cell}>
          <QuickActionCard action={action} />
        </View>
      ))}
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  // 14 + 6 cell padding = 20, so card edges line up with the hero and heading.
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: space(3.5) },
  cell: { width: '50%', padding: space(1.5) },
  // No fill and no border of its own: the glass supplies the frost, the tint,
  // the lit rim and the shadow, so a second border here would double the edge.
  card: {
    minHeight: 112,
    padding: space(3.5),
    borderRadius: radius.large,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...type.titleMedium, color: theme.glass.onGlass, marginTop: space(2.5) },
  value: { ...type.bodySmall, color: theme.glass.onGlassVariant },
});
