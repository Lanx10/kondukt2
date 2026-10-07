import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../../icons';
import { cardShadowFor, onPrimarySolid, radius, space, type, type KonduktTheme } from '../../theme';
import { useKonduktTheme } from '../../lib/themeContext';
import { useThemedStyles } from '../../lib/useThemedStyles';
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
 *
 * Every colour comes from the theme. This card used to read the light `palette`
 * at module scope, so in Dark mode the eyebrow, headline, body and meta — the
 * whole hierarchy — rendered in light-theme ink on a dark card, which is how the
 * Dashboard came to have the most unreadable text in the app.
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
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const solid = tone === 'active';
  const isError = tone === 'error';
  // White on the solid orange button, dark on the amber card, neutral elsewhere.
  const actionColour =
    actionTone === 'solid' ? '#FFFFFF' : solid ? theme.palette.onSecondary : theme.palette.onSurface;

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
          <Text
            style={[styles.eyebrow, solid && styles.eyebrowActive, isError && styles.eyebrowError]}
            accessibilityRole="header"
          >
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
        <Text style={[styles.body, solid && styles.bodyActive]}>{body}</Text>
        {meta ? <Text style={[styles.meta, solid && styles.metaActive]}>{meta}</Text> : null}
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

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
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
    backgroundColor: theme.palette.errorContainer,
    borderWidth: 1,
    borderColor: theme.palette.error,
  },
  // Solid amber, and the only yellow on the screen. `cardShadowFor` rather than
  // a second shadow: the same lift every other panel gets, so it sits at the
  // same depth - and loses that lift with them when visual effects are reduced.
  cardActive: {
    backgroundColor: theme.palette.secondary,
    borderRadius: radius.glass,
    ...cardShadowFor(theme),
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space(2),
  },
  eyebrow: {
    ...type.labelSmall,
    color: theme.palette.onSurfaceVariant,
  },
  eyebrowError: {
    color: theme.palette.error,
  },
  // Every ink on the solid amber card comes from the `onAmber` ramp, never
  // from the neutral ramp: `onSurfaceVariant` is a light warm grey in dark
  // mode, and on amber it measured 1.18:1 — the eyebrow, the body sentence and
  // the meta line all went with it.
  eyebrowActive: {
    color: theme.onSecondaryRamp.muted,
  },
  bodyActive: {
    color: theme.onSecondaryRamp.detail,
  },
  metaActive: {
    color: theme.onSecondaryRamp.muted,
  },
  eyebrowChip: {
    minHeight: 24,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: theme.palette.surfaceContainer,
  },
  eyebrowChipActive: {
    backgroundColor: theme.palette.onSecondary,
  },
  // Dark ground, amber type on the amber card: 7.4:1, where the pale
  // secondary container would sit at 1.6:1 and the status would go with it.
  eyebrowChipLabel: {
    ...type.labelSmall,
    color: theme.palette.onSurfaceVariant,
  },
  eyebrowChipLabelActive: {
    color: theme.palette.secondary,
  },
  title: {
    ...type.headlineSmall,
    color: theme.palette.onSurface,
    marginTop: space(1.5),
  },
  titleError: {
    color: theme.palette.error,
  },
  titleActive: {
    color: theme.palette.onSecondary,
  },
  body: {
    ...type.bodyMedium,
    color: theme.palette.onSurfaceVariant,
    marginTop: space(1.5),
  },
  meta: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
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
    backgroundColor: theme.palette.primarySolid,
  },
  actionLabelSolid: {
    color: onPrimarySolid,
  },
  actionLabelSolidActive: {
    color: theme.palette.onSecondary,
  },
  actionGhost: {
    borderWidth: 1,
    borderColor: theme.palette.outline,
  },
  actionGhostSolid: {
    borderColor: theme.palette.onSecondary,
  },
  actionLabelGhost: {
    color: theme.palette.onSurface,
  },
  actionLabel: {
    ...type.labelLarge,
  },
});
