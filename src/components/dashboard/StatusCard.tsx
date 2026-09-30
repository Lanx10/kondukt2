import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../../icons';
import { cardShadow, palette, radius, space, type } from '../../theme';
import { GlassCard } from '../GlassCard';

/**
 * The status slot: the Dashboard's hero, in all six of its answers.
 *
 * The reference draws six cards here — running trip, ready to start, nothing
 * recorded, a window from the past, an offline snapshot, and a read failure —
 * and five of them are the same shape: an eyebrow naming the state, a headline
 * saying what it means, a sentence of body copy, and sometimes a way out. The
 * sixth, a running trip, is the same card filled solid amber: it is the one
 * state a conductor has to register without reading, so it is the only amber
 * card on the screen and the only one whose fill the blur would wash out.
 *
 * One component rather than six, because six components is where they would
 * drift, and because the states differ in wording far more than in structure.
 */
export function StatusCard({
  eyebrow,
  eyebrowChip,
  title,
  body,
  meta,
  action,
  actionLabel,
  actionTone = 'solid',
  tone = 'glass',
  onPress,
}: {
  eyebrow: string;
  eyebrowChip?: string;
  title: string;
  body: string;
  meta?: string;
  action?: IconName;
  actionLabel?: string;
  actionTone?: 'solid' | 'ghost';
  tone?: 'glass' | 'active' | 'error';
  onPress?: () => void;
}) {
  const solid = tone === 'active';
  const isError = tone === 'error';
  // White on the solid orange button, dark on the amber card, neutral elsewhere.
  const actionColour =
    actionTone === 'solid' ? '#FFFFFF' : solid ? palette.onSecondary : palette.onSurface;

  // Solid amber: the one state a conductor registers without reading, and the
  // only card on the screen that leaves the glass run for it.
  const card = solid ? (
    <View style={[styles.card, styles.cardActive]}>{content()}</View>
  ) : (
    <GlassCard style={[styles.card, isError && styles.cardError]}>
      {content()}
    </GlassCard>
  );

  function content(): ReactNode {
    return (
      <>
        <View style={styles.eyebrowRow}>
          <Text style={[styles.eyebrow, isError && styles.eyebrowError]} accessibilityRole="header">
            {eyebrow}
          </Text>
          {eyebrowChip ? (
            <View style={[styles.eyebrowChip, solid && styles.eyebrowChipActive]}>
              <Text style={[styles.eyebrowChipLabel, solid && styles.eyebrowChipLabelActive]}>
                {eyebrowChip}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.title, isError && styles.titleError, solid && styles.titleActive]}>
          {title}
        </Text>
        <Text style={styles.body}>{body}</Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {actionLabel && onPress ? (
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            style={({ pressed }) => [
              styles.action,
              actionTone === 'ghost' ? styles.actionGhost : styles.actionSolid,
              solid && styles.actionGhostSolid,
              pressed && styles.pressed,
            ]}
          >
            {action ? <Icon name={action} size={18} color={actionColour} /> : null}
            <Text
              style={[
                styles.actionLabel,
                actionTone === 'ghost' ? styles.actionLabelGhost : styles.actionLabelSolid,
                solid && styles.actionLabelSolidActive,
              ]}
            >
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </>
    );
  }

  // Some reference titles carry their own full stop ("No trip running.") —
  // append one only when the title doesn't already end it, so a screen reader
  // never reads "running..".
  const titleSentence = title.endsWith('.') ? title : `${title}.`;
  const label = `${eyebrow}. ${eyebrowChip ? `${eyebrowChip}. ` : ''}${titleSentence} ${body}${
    meta ? ` ${meta}` : ''
  }`;

  return (
    <View style={styles.root} accessible accessibilityLabel={label} accessibilityRole="summary">
      {card}
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
    backgroundColor: palette.errorContainer,
    borderWidth: 1,
    borderColor: palette.error,
  },
  // Solid amber, and the only yellow on the screen. `cardShadow` rather than a
  // second shadow: same numbers as every other panel, so it sits at the same
  // depth.
  cardActive: {
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
  eyebrowChip: {
    minHeight: 24,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: palette.surfaceContainer,
  },
  eyebrowChipActive: {
    backgroundColor: palette.onSecondary,
  },
  // Dark ground, amber type on the amber card: 7.4:1, where the pale
  // secondary container would sit at 1.6:1 and the status would go with it.
  eyebrowChipLabel: {
    ...type.labelSmall,
    color: palette.onSurfaceVariant,
  },
  eyebrowChipLabelActive: {
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
  titleActive: {
    color: palette.onSecondary,
  },
  body: {
    ...type.bodyMedium,
    color: palette.onSurfaceVariant,
    marginTop: space(1.5),
  },
  meta: {
    ...type.bodySmall,
    color: palette.onSurfaceVariant,
    marginTop: space(2.5),
    fontVariant: ['tabular-nums'],
  },
  action: {
    marginTop: space(4),
    minHeight: 48,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(5),
    borderRadius: radius.full,
  },
  // Solid primary orange, not a pale container: the card's own fill is solid,
  // so the button under it is too. White on `primarySolid` is 5.2:1.
  actionSolid: {
    backgroundColor: palette.primarySolid,
  },
  actionLabelSolid: {
    color: '#FFFFFF',
  },
  actionLabelSolidActive: {
    color: palette.onSecondary,
  },
  actionGhost: {
    borderWidth: 1,
    borderColor: palette.outline,
  },
  actionGhostSolid: {
    borderColor: palette.onSecondary,
  },
  actionLabelGhost: {
    color: palette.onSurface,
  },
  actionLabel: {
    ...type.labelLarge,
  },
});
