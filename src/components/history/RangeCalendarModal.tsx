import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../icons';
import { palette, radius, space, tintedGlass, type } from '../../theme';
import { GlassCard } from '../GlassCard';
import { MONTH_NAMES, WEEKDAY_INITIALS } from '../../lib/calendar';
import { formatDateLong, startOfDay } from '../../lib/format';

/**
 * The custom-range picker: a month grid where a first tap sets the start and a
 * second sets the end.
 *
 * Hand-rolled for the same reason the Dashboard's DatePickerModal is — the
 * glass surfaces, the amber selection and the header pills all come from tokens
 * an external picker package could not promise. The one rule it enforces that
 * free-text entry could not: both ends are *picked*, so a range can never be
 * typed backwards or land on a day that has not happened.
 *
 * Days past today render but do not press: tomorrow cannot hold records, so an
 * enabled future day would open an empty screen and read as a bug.
 */
export function RangeCalendarModal({
  visible,
  onCancel,
  onApply,
}: {
  visible: boolean;
  onCancel: () => void;
  onApply: (start: number, end: number) => void;
}) {
  // Re-seeded from today on every open, with the same render-time reset
  // DatePickerModal uses: the component stays mounted under the Modal, so plain
  // useState would reopen on whichever month the user last browsed.
  const [viewed, setViewed] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastVisible, setLastVisible] = useState(visible);

  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) {
      const now = new Date();
      setViewed(new Date(now.getFullYear(), now.getMonth(), 1));
      setStart(null);
      setEnd(null);
      setError(null);
    }
  }

  const today = useMemo(() => startOfDay(new Date()).getTime(), []);

  // Six rows is the height every month shares, so the grid never jumps between
  // a 5-row February and a 6-row March. Out-of-month cells are inert spacers.
  const cells = useMemo(() => {
    const lead = viewed.getDay();
    const gridStart = new Date(viewed.getFullYear(), viewed.getMonth(), 1 - lead);
    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + i,
      );
      return {
        millis: day.getTime(),
        date: day.getDate(),
        inMonth: day.getMonth() === viewed.getMonth(),
      };
    });
  }, [viewed]);

  // A tap before the start moves the start rather than inverting the range, so
  // the user can correct the earlier end without clearing and re-picking.
  const pick = (millis: number) => {
    setError(null);
    if (start === null || end !== null) {
      setStart(millis);
      setEnd(null);
    } else if (millis < start) {
      setStart(millis);
    } else {
      setEnd(millis);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.scrim} onPress={onCancel}>
        <GlassCard style={styles.card} intensity={40}>
          <Pressable>
            <View
              style={styles.grabber}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <View style={styles.head}>
              <Pressable
                onPress={() => setViewed(new Date(viewed.getFullYear(), viewed.getMonth() - 1, 1))}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                hitSlop={12}
                style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
              >
                <Icon name="chevronLeft" size={20} color={palette.onSurfaceVariant} />
              </Pressable>
              <Text style={styles.month} accessibilityRole="header">
                {MONTH_NAMES[viewed.getMonth()]} {viewed.getFullYear()}
              </Text>
              <Pressable
                onPress={() => setViewed(new Date(viewed.getFullYear(), viewed.getMonth() + 1, 1))}
                accessibilityRole="button"
                accessibilityLabel="Next month"
                hitSlop={12}
                style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
              >
                <Icon name="chevron" size={20} color={palette.onSurfaceVariant} />
              </Pressable>
            </View>

            <View style={styles.weekdays}>
              {WEEKDAY_INITIALS.map((initial, index) => (
                <Text key={`${initial}${index}`} style={styles.weekday}>
                  {initial}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map(({ millis, date, inMonth }) => {
                const future = millis > today;
                const isStart = start !== null && millis === start;
                const isEnd = end !== null && millis === end;
                const isBetween =
                  start !== null && end !== null && millis > start && millis < end;
                const selectable = inMonth && !future;
                const edge = isStart || isEnd;
                const state = edge
                  ? `, ${isStart ? 'start' : 'end'} of the range`
                  : isBetween
                    ? ', inside the range'
                    : '';
                return (
                  <Pressable
                    key={millis}
                    onPress={() => pick(millis)}
                    disabled={!selectable}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatDateLong(new Date(millis))}${state}`}
                    accessibilityState={{ disabled: !selectable, selected: edge }}
                    style={({ pressed }) => [
                      styles.dayCell,
                      isBetween && styles.dayBetween,
                      edge && styles.dayEdge,
                      pressed && selectable && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayLabel,
                        !inMonth && styles.dayOutside,
                        future && styles.dayFuture,
                        isBetween && styles.dayBetweenLabel,
                        edge && styles.dayEdgeLabel,
                      ]}
                    >
                      {date}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.selection} accessibilityLiveRegion="polite">
              {start === null
                ? 'Tap a start date, then an end date.'
                : end === null
                  ? `${formatDateLong(new Date(start))} → tap an end date`
                  : `${formatDateLong(new Date(start))} – ${formatDateLong(new Date(end))}`}
            </Text>
            <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
              {error ?? ''}
            </Text>

            <View style={styles.actions}>
              <Pressable
                onPress={onCancel}
                accessibilityRole="button"
                accessibilityLabel="Cancel custom range"
                style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
              >
                <Text style={styles.ghostLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (start === null || end === null) {
                    setError('Choose both a start and an end date to apply the range.');
                    return;
                  }
                  onApply(start, end);
                }}
                accessibilityRole="button"
                accessibilityLabel="Apply custom range"
                style={({ pressed }) => [styles.solid, pressed && styles.pressed]}
              >
                <GlassCard
                  tint={tintedGlass.accent}
                  cornerRadius={radius.full}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <Text style={styles.solidLabel}>Apply range</Text>
              </Pressable>
            </View>
          </Pressable>
        </GlassCard>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: palette.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(6),
  },
  // 24px of air above and below, 20px at the sides: a centred dialog wants more
  // vertical room than the 20px square padding gave it, and a month grid is the
  // densest thing in the app.
  card: {
    width: '100%',
    maxWidth: 360,
    paddingVertical: space(6),
    paddingHorizontal: space(5),
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: palette.outlineVariant,
    alignSelf: 'center',
    marginBottom: space(3),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  month: {
    ...type.titleMedium,
    color: palette.onSurface,
    flex: 1,
    textAlign: 'center',
  },
  stepperButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdays: {
    flexDirection: 'row',
    marginTop: space(2.5),
    marginBottom: space(1.5),
    paddingVertical: space(1),
  },
  weekday: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
    width: `${100 / 7}%`,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space(1),
  },
  dayCell: {
    // 44px minimum, so the grid's own width decides the cell and the touch
    // target never drops below the reference's.
    minHeight: 44,
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.medium,
  },
  dayLabel: {
    ...type.bodyMedium,
    color: palette.onSurface,
    fontVariant: ['tabular-nums'],
  },
  dayOutside: {
    color: 'transparent',
  },
  dayFuture: {
    color: palette.outlineVariant,
  },
  // The span between the two picked days: a contiguous band, so a two-week
  // range reads as one selection rather than two highlighted days.
  dayBetween: {
    backgroundColor: palette.primaryContainer,
    borderRadius: 0,
  },
  dayBetweenLabel: {
    color: palette.onPrimaryContainer,
  },
  dayEdge: {
    backgroundColor: palette.primarySolid,
  },
  dayEdgeLabel: {
    color: palette.onPrimary,
    fontFamily: 'Poppins_700Bold',
  },
  selection: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginTop: space(3),
  },
  // `minHeight` reserves one line whether or not there is a message.
  error: {
    ...type.bodySmall,
    color: palette.error,
    marginTop: space(2.5),
    minHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: space(2),
    marginTop: space(2),
  },
  ghost: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: palette.outline,
  },
  ghostLabel: {
    ...type.labelLarge,
    color: palette.onSurface,
  },
  solid: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  solidLabel: {
    ...type.labelLarge,
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.6,
  },
});
