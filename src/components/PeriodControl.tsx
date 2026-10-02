import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../icons';
import { radius, space, tintedGlass, type, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { GlassCard } from './GlassCard';
import { MONTH_NAMES } from '../lib/calendar';
import { RANGE_SEGMENTS, type PeriodState } from '../lib/historyState';
import { formatDate, formatShortDate } from '../lib/format';

/** The formatters the period control's labels are built from. */
export const fmtShort = (millis: number) => formatShortDate(new Date(millis));
export const fmtDay = (millis: number) => formatDate(new Date(millis));
export const fmtMonth = (millis: number) => MONTH_NAMES[new Date(millis).getMonth()];
export const fmtYear = (millis: number) => String(new Date(millis).getFullYear());

/** The period modes a caller can be in. */
export type PeriodMode = 'day' | 'week' | 'month' | 'custom';

/** The caption under the card: a day names its own hours, a span calls itself inclusive. */
export function periodCaption(period: PeriodState, mode: PeriodMode): string {
  if (mode === 'day') return `${period.datesLabel} · 12:00 AM – 11:59 PM`;
  return `${period.datesLabel} · inclusive`;
}

/**
 * The period control: a Day/Week/Month radiogroup, a stepper, and a calendar
 * button for a hand-picked range.
 *
 * Shared by the Dashboard and History because the reference gives both the same
 * control — one period, not a chip wall of presets and not free-text dates. It
 * owns no state: the caller holds the mode, offset and custom window (it needs
 * the resolved window for its own queries anyway) and hands down the `PeriodState`
 * they resolve to. This renders it and reports intent.
 */
export function PeriodControl({
  label,
  period,
  mode,
  caption,
  onStep,
  onSelectMode,
  onOpenCalendar,
  onPress,
}: {
  label?: string;
  period: PeriodState;
  mode: PeriodMode;
  caption?: ReactNode;
  onStep: (delta: number) => void;
  onSelectMode: (mode: Exclude<PeriodMode, 'custom'>) => void;
  onOpenCalendar: () => void;
  onPress?: () => void;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.root}>
      {label ? (
        <Text style={styles.label} accessibilityRole="header">
          {label}
        </Text>
      ) : null}

      <GlassCard style={styles.card}>
        <View style={styles.top}>
          <View style={styles.segments}>
            {RANGE_SEGMENTS.map((segment) => {
              const selected = period.isCustom === false && mode === segment.mode;
              return (
                <Pressable
                  key={segment.mode}
                  onPress={() => onSelectMode(segment.mode)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Group records by ${segment.label.toLowerCase()}`}
                  accessibilityState={{ checked: selected }}
                  // Native reads `accessibilityState`; the web build only maps
                  // the `aria-*` prop, so a segment that looks selected but
                  // announces nothing is announced as nothing.
                  aria-checked={selected}
                  style={({ pressed }) => [styles.segment, pressed && styles.pressed]}
                >
                  {selected ? (
                    <GlassCard
                      tint={tintedGlass.accent}
                      cornerRadius={radius.full}
                      style={StyleSheet.absoluteFill}
                      pointerEvents="none"
                    />
                  ) : null}
                  <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
                    {segment.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <IconButton
            icon="calendar"
            label="Choose a custom date range"
            onPress={onOpenCalendar}
            active={period.isCustom}
          />
        </View>

        <View style={styles.stepper}>
          <IconButton
            icon="chevronLeft"
            label="Previous period"
            onPress={() => onStep(-1)}
            disabled={!period.canPrev}
          />
          <View style={styles.stepperCentre}>
            <Text style={styles.stepperLabel} accessibilityRole="header" numberOfLines={1}>
              {period.label}
            </Text>
            <Text style={styles.stepperDates} numberOfLines={1}>
              {period.datesLabel}
            </Text>
          </View>
          <IconButton
            icon="chevron"
            label="Next period"
            onPress={() => onStep(1)}
            disabled={!period.canNext}
          />
        </View>
      </GlassCard>

      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? 'Return to today' : undefined}
        accessibilityLiveRegion="polite"
        style={({ pressed }) => [styles.caption, pressed && styles.pressed]}
      >
        <View style={styles.captionMarker} />
        <Text style={styles.captionText}>
          {caption ?? (
            <>
              Showing <Text style={styles.captionStrong}>{periodCaption(period, mode)}</Text>
            </>
          )}
        </Text>
      </Pressable>
    </View>
  );
}

/** The round icon button the stepper and the calendar control share. */
function IconButton({
  icon,
  label,
  onPress,
  disabled,
  active,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      style={({ pressed }) => [
        styles.iconButton,
        active && styles.iconButtonActive,
        disabled && styles.iconButtonDisabled,
        pressed && styles.pressed,
      ]}
    >
      {/* `palette.primary` as INK, not `primarySolid` as a fill: the stepper
          sits on a surface whose lightness flips with the mode, and the solid
          step clears 5.2:1 on the light track but falls to 1.9:1 on the dark
          one. The role colour is #E65100 in light (3.5:1 on the track) and
          #FFB68B in dark (8:1) — the accent on its own surface, either way. */}
      <Icon name={icon} size={20} color={theme.palette.primary} />
    </Pressable>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  root: {
    marginTop: space(3),
    marginHorizontal: space(5),
  },
  // The reference's `.section-label { margin: 0 0 10px }`, in the app's own
  // label role — the same 11/600/0.6 the other section labels wear.
  label: {
    ...type.labelSmall,
    color: theme.palette.onSurfaceVariant,
    marginBottom: space(2.5),
  },
  // The reference's `.range-card { padding: 16px }`, a little more air
  // vertically: two 44–48px control rows in a column need the room.
  card: {
    paddingVertical: space(5),
    paddingHorizontal: space(4),
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
  },
  segments: {
    flex: 1,
    flexDirection: 'row',
    gap: space(1),
    padding: space(1),
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: theme.palette.outlineVariant,
    // Translucent, not the old solid white: the reference's track is a white
    // wash the field shows through, like every other control on this screen.
    backgroundColor: theme.glass.tint,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  segmentLabel: {
    ...type.bodyMedium,
    fontFamily: 'Poppins_600SemiBold',
    color: theme.palette.onSurfaceVariant,
  },
  segmentLabelSelected: {
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: theme.palette.outlineVariant,
    backgroundColor: theme.glass.tint,
  },
  iconButtonActive: {
    backgroundColor: theme.palette.primaryContainer,
    borderWidth: 2,
    borderColor: theme.palette.primary,
  },
  iconButtonDisabled: {
    opacity: 0.4,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    marginTop: space(3.5),
  },
  // Stretched, not shrink-wrapped: the reference centres this column's *text*,
  // and a shrink-wrapped column cannot centre a label wider than the space
  // between the two stepper buttons — "Sep 21 – Sep 27, 2026" on a small phone.
  stepperCentre: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
  },
  stepperLabel: {
    ...type.titleMedium,
    color: theme.palette.onSurface,
    textAlign: 'center',
  },
  stepperDates: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginTop: space(0.5),
    textAlign: 'center',
  },
  caption: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space(2),
    marginTop: space(3),
  },
  captionMarker: {
    width: 6,
    height: 6,
    borderRadius: 2,
    backgroundColor: theme.palette.primarySolid,
    alignSelf: 'center',
  },
  captionText: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    flex: 1,
  },
  captionStrong: {
    color: theme.palette.onSurface,
    fontFamily: 'Poppins_600SemiBold',
  },
  pressed: {
    opacity: 0.88,
  },
});
