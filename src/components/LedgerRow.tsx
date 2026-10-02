import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../icons';
import { radius, space, type, type Accent, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { GlassCard } from './GlassCard';

/** The three accent pairs a row's icon chip can take. */
type RowTone = Accent;

/**
 * One ledger row: the shape both the Dashboard and History draw their lists
 * from.
 *
 * Presentational on purpose. It takes already-formatted strings and renders
 * the reference's grid — a 40px tone chip, a main column of title/sub/meta, a
 * right column of status and amount, and a chevron — so two screens reporting
 * the same records cannot drift into two different row designs. A row is a list
 * item, not a panel, so it carries the tighter 16px corner rather than the
 * app's 28px glass shape.
 *
 * `stacked` is the reference's `body.stack-rows`: below the row's width, or at
 * a large font scale, the right column drops to its own line under the body and
 * the chevron goes, because a route, a fare and a chevron cannot share a line
 * at that size without truncating one of them.
 */
export function LedgerRow({
  tone,
  icon,
  title,
  titleSuffix,
  sub,
  subExtra,
  meta,
  amount,
  amountLabel,
  status,
  chevron = false,
  stacked,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  tone: RowTone;
  icon: IconName;
  title: string;
  titleSuffix?: string;
  sub?: string;
  subExtra?: ReactNode;
  meta?: string;
  amount?: string;
  amountLabel?: string;
  status?: string;
  chevron?: boolean;
  stacked: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const body = (
    <GlassCard
      cornerRadius={radius.large}
      style={[styles.card, stacked && styles.cardStacked]}
    >
      <View style={styles.lead}>
        <View style={[styles.chip, { backgroundColor: theme.accent[tone].container }]}>
          <Icon name={icon} size={20} color={theme.accent[tone].fg} />
        </View>
        <View style={styles.main}>
          <Text style={styles.title}>
            {title}
            {titleSuffix ? <Text style={styles.titleSuffix}> {titleSuffix}</Text> : null}
          </Text>
          {sub || subExtra ? (
            <View style={styles.subRow}>
              {sub ? <Text style={styles.sub}>{sub}</Text> : null}
              {subExtra}
            </View>
          ) : null}
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
      </View>
      {status || amount || amountLabel ? (
        <View style={[styles.side, stacked && styles.sideStacked]}>
          {status ? (
            <View
              style={[
                styles.statusPill,
                status === 'In progress' ? styles.statusActive : styles.statusCompleted,
              ]}
            >
              <Text
                style={[
                  styles.statusLabel,
                  status === 'In progress' ? styles.statusLabelActive : styles.statusLabelCompleted,
                ]}
              >
                {status}
              </Text>
            </View>
          ) : null}
          {amountLabel ? <Text style={styles.amountLabel}>{amountLabel}</Text> : null}
          {amount ? (
            <Text style={styles.amount} numberOfLines={1}>
              {amount}
            </Text>
          ) : null}
        </View>
      ) : null}
      {chevron && !stacked ? (
        // `outline`, not `outlineVariant`: the variant is a 1.7:1 hairline in
        // light and 1.5:1 on the dark surface container — too faint to be the
        // affordance telling you the row opens. Every other chevron in the app
        // already uses `outline`.
        <Icon name="chevron" size={18} color={theme.palette.outline} />
      ) : null}
    </GlassCard>
  );

  if (!onPress) {
    return (
      <View style={styles.gutter}>
        <View accessible accessibilityLabel={accessibilityLabel}>
          {body}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.gutter}>
      <Pressable
        onPress={onPress}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    </View>
  );
}

/** The small category chip a ticket row carries in its sub line. */
export function CategoryChip({ label }: { label: string }) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.categoryChip}>
      <Text style={styles.categoryChipLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  gutter: {
    marginHorizontal: space(5),
    marginTop: space(3),
  },
  pressed: { opacity: 0.88 },
  // Top-aligned, not centred: the chip sits level with the row's first line
  // instead of drifting down beside a three-line body.
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    paddingVertical: space(3.5),
    paddingHorizontal: space(4),
  },
  cardStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  lead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    flex: 1,
    minWidth: 0,
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...type.titleMedium,
    color: theme.palette.onSurface,
  },
  titleSuffix: {
    ...type.bodySmall,
    fontFamily: 'Poppins_400Regular',
    color: theme.palette.onSurfaceVariant,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: space(1.5),
    marginTop: space(0.5),
  },
  sub: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
  },
  meta: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginTop: space(1.5),
  },
  side: {
    alignItems: 'flex-end',
    gap: space(1.5),
    maxWidth: '45%',
  },
  sideStacked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: '100%',
    // Clear of the icon chip: 40 wide plus the 12 gap.
    paddingLeft: 52,
  },
  amount: {
    ...type.bodyMedium,
    color: theme.palette.onSurface,
    fontVariant: ['tabular-nums'],
  },
  amountLabel: {
    ...type.labelSmall,
    color: theme.palette.onSurfaceVariant,
  },
  chip: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.medium,
  },
  // The reference's chips: 26px status, 22px category, 11px/10px labels.
  statusPill: {
    minHeight: 26,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  statusActive: {
    backgroundColor: theme.accent.secondary.container,
  },
  statusCompleted: {
    backgroundColor: theme.accent.tertiary.container,
  },
  statusLabel: {
    ...type.labelSmall,
  },
  statusLabelActive: {
    color: theme.accent.secondary.onContainer,
  },
  statusLabelCompleted: {
    color: theme.accent.tertiary.onContainer,
  },
  categoryChip: {
    paddingHorizontal: space(2),
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: theme.palette.surfaceContainer,
  },
  categoryChipLabel: {
    ...type.labelSmall,
    color: theme.palette.onSurfaceVariant,
  },
  });
