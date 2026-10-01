import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../../icons';
import { cardShadow, glassBlur, palette, radius, space, tintedGlass, type } from '../../theme';
import { GlassCard } from '../GlassCard';
import { Skeleton } from '../SummaryDisclosure';

/** One of the hero's three figures: a number and its label. */
export type HeroFigure = { value: string; label: string };

/** The hero's actions: the filled one carries an icon, the ghost one does not. */
export type HeroAction = { label: string; onPress: () => void; icon?: IconName };

/**
 * The home hero: the one card that says what the app is doing right now.
 *
 * Five states, and the state *is* the design — a conductor opening this screen
 * reads the card, not the tiles below it. A running trip is solid amber, the
 * only amber card in the app, because it is the one state that has to register
 * without being read. Everything else is glass, because everything else is
 * waiting rather than happening.
 *
 * The running card carries the day's three figures and two actions, so the
 * common case needs no navigation at all: see the money, record the next fare.
 */
export function HomeHero({
  state,
  eyebrow,
  eyebrowChip,
  title,
  body,
  when,
  figures,
  actions,
  /** A muted run-in inside the title, e.g. the arrow between two places. */
  titleSuffix,
}: {
  state: 'loading' | 'ready' | 'running' | 'error';
  eyebrow: string;
  eyebrowChip?: string;
  title: string;
  body: string;
  when?: string;
  figures?: HeroFigure[];
  actions?: HeroAction[];
  titleSuffix?: string;
}) {
  const running = state === 'running';
  const failed = state === 'error';

  const content: ReactNode = (
    <>
      <View style={styles.eyebrowRow}>
        <Text style={[styles.eyebrow, failed && styles.eyebrowError]} accessibilityRole="header">
          {eyebrow}
        </Text>
        {eyebrowChip ? (
          <View style={[styles.chip, running && styles.chipRunning]}>
            <Text style={[styles.chipLabel, running && styles.chipLabelRunning]}>
              {eyebrowChip}
            </Text>
          </View>
        ) : null}
      </View>

      {state === 'loading' ? (
        <>
          <Skeleton height={26} style={styles.skeletonTitle} />
          <Skeleton height={16} style={styles.skeletonWhen} />
        </>
      ) : (
        <>
          <Text
            style={[styles.title, failed && styles.titleError, running && styles.titleRunning]}
          >
            {title}
            {titleSuffix ? <Text style={styles.titleSuffix}> {titleSuffix}</Text> : null}
          </Text>
          {when ? (
            <Text style={[styles.when, running && styles.whenRunning]}>{when}</Text>
          ) : null}
        </>
      )}

      <Text style={styles.body}>{body}</Text>

      {figures && figures.length > 0 ? (
        <View style={[styles.figures, running && styles.figuresRunning]}>
          {figures.map((figure) => (
            <View key={figure.label} style={styles.figure}>
              <Text style={[styles.figureValue, running && styles.figureValueRunning]}>
                {figure.value}
              </Text>
              <Text style={[styles.figureLabel, running && styles.figureLabelRunning]}>
                {figure.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {state === 'loading' ? <Skeleton height={48} style={styles.skeletonButton} /> : null}

      {state !== 'loading' && actions && actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) =>
            action.icon ? (
              // The primary action: an orange glass pill — the same tinted
              // GlassCard the chrome pills use, not a flat fill.
              <GlassCard
                key={action.label}
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                tint={tintedGlass.accent}
                cornerRadius={radius.full}
                style={styles.action}
              >
                <Icon name={action.icon} size={18} color="#FFFFFF" />
                <Text style={styles.actionLabel}>{action.label}</Text>
              </GlassCard>
            ) : (
              // The secondary: outlined, so the filled one stays the only fill.
              <Pressable
                key={action.label}
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => [
                  styles.action,
                  styles.actionGhost,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.actionLabel,
                    styles.actionLabelGhost,
                    running && styles.actionLabelRunning,
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            ),
          )}
        </View>
      ) : null}
    </>
  );

  // Solid amber for the running state — the one card in the app that leaves
  // the glass run, because it has to register without being read.
  return (
    <View style={styles.root}>
      {running ? (
        <View style={[styles.card, styles.cardRunning]}>{content}</View>
      ) : (
        <GlassCard
          intensity={glassBlur}
          style={[styles.card, failed && styles.cardError]}
          accessible
          accessibilityLabel={`${eyebrow}. ${title}. ${body}${when ? ` ${when}` : ''}`}
        >
          {content}
        </GlassCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: space(2),
    marginHorizontal: space(5),
  },
  pressed: {
    opacity: 0.88,
  },
  card: {
    padding: space(5),
  },
  cardError: {
    // The reference's `.hero-error` sets `border: none` — the pale red fill
    // and the red eyebrow carry the state, not an outline around the card.
    backgroundColor: palette.errorContainer,
  },
  // Solid amber, the only yellow in the app. `cardShadow` rather than a second
  // shadow: the same numbers as every other panel, so it sits at the same depth.
  cardRunning: {
    backgroundColor: palette.secondary,
    borderRadius: radius.glass,
    ...cardShadow,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space(2),
  },
  eyebrow: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
  },
  eyebrowError: {
    color: palette.error,
  },
  chip: {
    minHeight: 24,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: palette.surfaceContainer,
  },
  // Dark ground, amber type on the amber card: 7.4:1, where the pale secondary
  // container sits at 1.6:1 and the status would go with it.
  chipRunning: {
    backgroundColor: palette.onSecondary,
  },
  chipLabel: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
  },
  chipLabelRunning: {
    color: palette.secondary,
  },
  title: {
    ...type.headlineSmall,
    color: palette.onSurface,
    marginTop: space(1.5),
  },
  titleError: {
    color: palette.error,
  },
  titleRunning: {
    color: palette.onSecondary,
  },
  titleSuffix: {
    color: palette.onSurfaceVariant,
  },
  when: {
    ...type.bodyMedium,
    color: palette.onSurfaceVariant,
    marginTop: space(0.5),
  },
  whenRunning: {
    color: palette.onSecondary,
  },
  body: {
    ...type.bodyMedium,
    color: palette.onSurfaceVariant,
    marginTop: space(2),
  },
  figures: {
    flexDirection: 'row',
    gap: space(6),
    marginTop: space(3.5),
    paddingTop: space(3.5),
    borderTopWidth: 1,
    // The outline step, which reads correctly on glass. On the amber card a
    // grey rule looks like dirt, so `figureRunning` swaps in a hair over the
    // fill's own dark tone — see `figures` on the running card below.
    borderTopColor: palette.outline,
  },
  figuresRunning: {
    borderTopColor: 'rgba(61, 46, 0, 0.25)',
  },
  figure: {
    flex: 1,
  },
  figureValue: {
    ...type.titleMedium,
    color: palette.onSurface,
    fontVariant: ['tabular-nums'],
  },
  figureValueRunning: {
    color: palette.onSecondary,
  },
  figureLabel: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
    marginTop: 1,
  },
  figureLabelRunning: {
    color: palette.onSurfaceVariant,
  },
  actions: {
    flexDirection: 'row',
    gap: space(2),
    marginTop: space(4),
  },
  // The tinted GlassCard carries the orange; this is geometry only. White on
  // the accent tint clears 5:1 in both modes, so the label never darkens.
  action: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.full,
  },
  actionGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    // The reference keeps `--outline` here even on the amber card; the darker
    // onSecondary border this used to swap in was the app's own invention.
    borderColor: palette.outline,
  },
  actionLabel: {
    ...type.labelLarge,
    color: '#FFFFFF',
  },
  actionLabelGhost: {
    color: palette.onSurface,
  },
  actionLabelRunning: {
    color: palette.onSecondary,
  },
  skeletonTitle: {
    marginTop: space(3),
  },
  skeletonWhen: {
    marginTop: space(2),
  },
  skeletonButton: {
    marginTop: space(4),
    borderRadius: radius.full,
  },
});
