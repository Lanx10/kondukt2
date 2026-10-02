import { type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { Icon } from '../icons';
import { maxContentWidth, radius, space, tintedGlass, type, type KonduktTheme } from '../theme';

import { useThemedStyles } from '../lib/useThemedStyles';
import { GlassBackdrop } from './GlassBackdrop';
import { GlassCard } from './GlassCard';

/**
 * The section-screen chrome shared by the sub-screens.
 *
 * Generalised from the Trip Tickets screen's header: the same back pill,
 * the same title pill, the same glass backdrop slot, one gutter and one
 * readable width — so every section screen reads as the same app one level
 * down. The back control is the caller's navigation; this component owns
 * nothing but the layout.
 *
 * THE THEME IS CONSUMED HERE, not imported: a static light-palette import
 * painted every screen's header light while the body re-themed, which is the
 * one bug that makes dark mode look broken from the first tap. The two solid
 * pills are painted with `primarySolid`, which is deliberately identical in
 * both modes, so their foreground is an explicit white rather than the
 * palette's `onPrimary` — dark's `onPrimary #4E2200` on `#C2410C` measures
 * 2.6:1, and white measures 5.2:1 in light AND dark.
 */
export function SectionChrome({
  title,
  subtitle,
  /** Optional trailing slot, e.g. Current Trip's start date. Squeezes the title pill. */
  trailing,
  /** Optional override; defaults to the plain "Back". */
  backLabel,
  /**
   * Sentence-case override for the reader. All-caps visual titles ("ADD TERMINAL")
   * read as acronyms when spelled letter by letter; the visual casing stays as
   * passed. Defaults to the visible title.
   */
  titleAccessibilityLabel,
  /**
   * Title-pill height. 44 fits a title alone; a title with a subtitle wants the
   * reference's 56, which is what every screen that shows both should pass.
   */
  titleMinHeight = 44,
  /**
   * How the pill's text block sits. The centered pill (default) is the shared
   * section header; the list screens' own reference left-aligns the pair and
   * sizes the title 16/600 — those screens opt in rather than every header
   * moving at once.
   */
  titleAlign = 'center',
  /** Extra title ink, e.g. the list reference's title-m role. */
  titleStyle,
  /** Extra subtitle ink, e.g. the list reference's body-s role. */
  subtitleStyle,
  onBack,
  insets,
  testID,
  backTestID,
  subtitleTestID,
  children,
}: {
  title: string;
  /** A screen with no supporting line renders the title pill alone. */
  subtitle?: string;
  /** Optional trailing slot, e.g. Current Trip's start date. */
  trailing?: ReactNode;
  /** Optional override; defaults to the plain "Back". */
  backLabel?: string;
  titleAccessibilityLabel?: string;
  titleMinHeight?: number;
  titleAlign?: 'center' | 'flex-start';
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  onBack: () => void;
  insets: { top: number; bottom: number };
  /** Addresses the chrome and its back control for the design tool's inspector. */
  testID?: string;
  backTestID?: string;
  /** Addresses the subtitle line for the inspector — the chrome's third id. */
  subtitleTestID?: string;
  children: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View testID={testID} style={[styles.screen, { paddingTop: insets.top }]}>
      {/* The field, owned here once: screens that used to sit on the raw page
          (no backdrop of their own) showed the canvas instead — never a flat
          page behind the glass stack. Screens that already paint their own
          backdrop render the same gradient in the same place, so the double
          render is visually identical. */}
      <GlassBackdrop />
      <View style={[styles.header, styles.readableWidth]}>
        <GlassCard
          onPress={onBack}
          testID={backTestID}
          accessibilityRole="button"
          accessibilityLabel={backLabel ?? 'Back'}
          hitSlop={12}
          tint={tintedGlass.accent}
          cornerRadius={radius.full}
          style={styles.backCard}
        >
          {/* Explicit white: the pill is a filled accent surface in both modes,
              and dark's own onPrimary is a dark ink that would vanish on it. */}
          <Icon name="chevronLeft" size={20} color="#FFFFFF" />
        </GlassCard>
        <GlassCard
          tint={tintedGlass.accent}
          cornerRadius={radius.full}
          style={[
            styles.titleCard,
            { minHeight: titleMinHeight, alignItems: titleAlign },
          ]}
        >
          <Text
            style={[styles.headerTitle, titleStyle]}
            numberOfLines={1}
            accessibilityRole="header"
            accessibilityLabel={titleAccessibilityLabel ?? title}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.headerSubtitle, subtitleStyle]}
              numberOfLines={1}
              testID={subtitleTestID}
            >
              {subtitle}
            </Text>
          ) : null}
        </GlassCard>
        {trailing ? <View style={styles.trailingSlot}>{trailing}</View> : null}
      </View>
      {children}
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
    screen: { flex: 1 },
    readableWidth: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: space(3),
      paddingHorizontal: space(5),
      gap: space(3),
    },
    // ORANGE GLASS: a real GlassCard painted with the accent tint, so both
    // pills carry the same blur, grain and lit rim as the rest of the stack
    // instead of a flat orange lozenge. The tint is GlassCard's `tint` prop, so
    // only geometry lives here.
    backCard: {
      width: 44,
      height: 44,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleCard: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      // The reference pill is 5px/16px all round; the vertical pad is what
      // makes a title+subtitle pair land at the reference's 52 rather than
      // squeezing into the 44 minimum.
      paddingHorizontal: space(4),
      paddingVertical: space(1.25),
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    trailingSlot: {
      minWidth: 44,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    headerTitle: { ...type.headlineSmall, color: '#FFFFFF' },
    // Full white, not the reference screens' .85: white on #C2410C is
    // 5.2:1, and .85 lands at 4.1:1 — under AA for 11px text. The ticket
    // reference carries the same note.
    // 1px over the title, exactly as the reference's `.chrome-sub` margin.
    headerSubtitle: { ...type.labelSmall, color: '#FFFFFF', marginTop: 1 },
  });
