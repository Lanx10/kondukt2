import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../components/GlassCard';
import { SectionChrome } from '../components/SectionChrome';
import { Icon, type IconName } from '../icons';
import {
  cardShadow,
  maxContentWidth,
  onPrimarySolid,
  radius,
  space,
  type,
  type KonduktTheme,
  type ThemeMode,
} from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { loadThemeMode, saveThemeMode } from '../lib/preferences';

export type AdvancedSettingsScreenProps = {
  onBack: () => void;
};

type AppearanceOption = {
  mode: ThemeMode;
  icon: IconName;
  label: string;
  /** The consequence, which is the thing being chosen between. */
  sub: string;
};

const OPTIONS: AppearanceOption[] = [
  { mode: 'light', icon: 'lightMode', label: 'Light mode', sub: 'Bright surfaces, high contrast.' },
  { mode: 'dark', icon: 'darkMode', label: 'Dark mode', sub: 'Dimmed surfaces, less glare at night.' },
];

/**
 * The Advanced Settings screen: one boolean, two options, and the facts
 * about where the value lands — advanced-settings.html made real.
 *
 * THE TAP IS THE COMMIT. The audit is explicit that a two-option toggle
 * needs no confirm step, pending value, dirty flag or Save button: tapping a
 * mode paints the whole screen before the write resolves, because the answer
 * to a theme tap is the theme. A refused write reverts to the mode read back
 * from storage — never the one remembered — and says so in the one banner
 * this screen owns; the happy path renders no message at all, because the
 * re-themed screen is the confirmation.
 *
 * Writes are chained, never raced: a second tap re-targets the same promise
 * chain, so the last tap wins and the preference store never receives two
 * out-of-order writes. There is no in-flight guard — there is nothing to
 * confirm and nothing to double-submit. The stored value is preferences.ts'
 * own single boolean (`"1"` dark, `"0"` light, anything else light), written
 * through the same accessor the app root reads at launch.
 */
export function AdvancedSettingsScreen({ onBack }: AdvancedSettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const { theme, setThemeMode } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // The failure copy, or null. The happy path never renders a message.
  const [error, setError] = useState<string | null>(null);
  // The painted mode, readable synchronously: a second tap inside one frame
  // must no-op against what is ON SCREEN, not against the context value the
  // closure still holds.
  const modeRef = useRef<ThemeMode>(theme.mode);
  // The write chain: sequential by construction, last tap wins.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const commit = useCallback(
    (next: ThemeMode) => {
      if (next === modeRef.current) return; // the checked option is a no-op
      modeRef.current = next;
      setError(null);
      setThemeMode(next); // the paint is optimistic — the answer is the theme

      chainRef.current = chainRef.current
        .then(() => saveThemeMode(next))
        .then((ok) => {
          if (ok) return;
          // Revert to what is still on disk: a later tap may already have
          // moved the screen on, and the disk never did. Read back through
          // the preferences accessor, never from memory of our own state.
          return loadThemeMode().then((stored) => {
            const onDisk: ThemeMode = stored ?? 'light';
            modeRef.current = onDisk;
            setThemeMode(onDisk);
            setError(
              `Kondukt could not save that change, so the screen is back on ${
                onDisk === 'dark' ? 'Dark' : 'Light'
              } mode. Nothing was lost — tap again to retry.`,
            );
          });
        });
    },
    [setThemeMode],
  );

  const subtitle = `One setting · ${theme.mode === 'dark' ? 'Dark' : 'Light'} mode`;

  return (
    // The outer View paints the theme background; SectionChrome owns the top
    // inset itself, so it must not be applied here as well.
    <View style={styles.screen}>
      <SectionChrome
        title="Advanced Settings"
        subtitle={subtitle}
        titleMinHeight={56}
        onBack={onBack}
        insets={insets}
        // The previous screen is Settings — the label names it.
        backLabel="Back to Settings"
        testID="as-chrome"
        backTestID="as-back"
      >
        <ScrollView
          contentContainerStyle={[
            styles.column,
            { paddingBottom: insets.bottom + space(9) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* The failure branch, first in the column so a refusal is never
              below the fold. role="alert": it answers the tap that caused it.
              No dismiss — closing it would hide why the write was refused. */}
          {error !== null ? (
            <View
              testID="as-msg"
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={styles.msg}
            >
              <Icon name="alert" size={18} color={theme.palette.onErrorContainer} />
              <Text style={styles.msgText}>{error}</Text>
            </View>
          ) : null}

          <View testID="as-config">
            <Text
              accessibilityRole="header"
              style={[
                styles.heading,
                // The heading gets its 20 from the column when it is first,
                // and only earns its own when a banner took the top slot —
                // one rhythm, applied once.
                error !== null && { marginTop: space(5) },
              ]}
            >
              APPEARANCE
            </Text>

            {/* One radio group over two options: the setting is one boolean.
                The group is labelled by the heading above it, and selection is
                the solid fill plus a mark plus aria-selected. */}
            <View
              testID="as-modes"
              accessibilityRole="radiogroup"
              accessibilityLabel="APPEARANCE"
              style={styles.modes}
            >
              {OPTIONS.map((option) => {
                const selected = theme.mode === option.mode;
                return (
                  <Pressable
                    key={option.mode}
                    onPress={() => commit(option.mode)}
                    accessibilityRole="radio"
                    accessibilityLabel={`${option.label}. ${option.sub}`}
                    // `aria-checked` DIRECTLY: react-native-web 0.21 forwards
                    // aria-* props to the DOM and drops `accessibilityState`,
                    // while RN core merges the aria prop into the native
                    // state — both platforms get the checked state from this
                    // one prop. `accessibilityState.checked` rides along as
                    // the native-side belt.
                    aria-checked={selected}
                    accessibilityState={{ checked: selected }}
                    style={({ pressed }) => [
                      styles.option,
                      selected && styles.optionSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.chip, selected && styles.chipSelected]}>
                      <Icon
                        name={option.icon}
                        size={22}
                        color={
                          selected
                            ? theme.palette.primarySolid
                            : theme.palette.onTertiaryContainer
                        }
                      />
                    </View>
                    <View style={styles.optionBody}>
                      <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>
                        {option.label}
                      </Text>
                      <Text style={[styles.optionSub, selected && styles.optionSubSelected]}>
                        {option.sub}
                      </Text>
                    </View>
                    {/* The mark: a ring at rest, a filled check when chosen.
                        Decorative — the label and the selected state already
                        say it to the reader. */}
                    <View
                      style={[styles.mark, selected && styles.markSelected]}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      {selected ? (
                        <Icon name="check" size={13} color={theme.palette.primarySolid} />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text testID="as-commit" style={styles.commitHint}>
              Applies the moment you tap it. There is nothing to save.
            </Text>
          </View>

          {/* What the app can actually prove about the value — each fact is
              about the value, not about the UI. This is what fills the screen
              honestly instead of a second setting. The two facts about where
              the value lands share ONE card: one paragraph, one surface. */}
          <GlassCard testID="as-how" style={styles.howCard}>
            <Text accessibilityRole="header" style={styles.heading}>
              HOW THIS SAVES
            </Text>
            <View style={styles.howList}>
              <View style={styles.howRow}>
                <Icon name="zap" size={16} color={theme.glass.accentPrimary} />
                <Text style={styles.howBody}>
                  <Text style={styles.howLead}>Takes effect immediately.</Text>
                  {' The whole screen changes as you tap, so you see the mode before you decide to keep it.'}
                </Text>
              </View>
              <View style={styles.howRow}>
                <Icon name="lock" size={16} color={theme.glass.accentPrimary} />
                <Text style={styles.howBody}>
                  <Text style={styles.howLead}>Stays on the handset.</Text>
                  {' It is written to local storage with the rest of the configuration. Nothing is uploaded.'}
                </Text>
              </View>
              <View style={styles.howRow}>
                <Icon name="clock" size={16} color={theme.glass.accentPrimary} />
                <Text style={styles.howBody}>
                  <Text style={styles.howLead}>Is read once at launch.</Text>
                  {' Kondukt opens in the mode you leave it in, so a change made at night is still there at first boarding.'}
                </Text>
              </View>
            </View>

            {/* The last line of the card, not a fifth card of its own: the
                offline statement rides the how-card with a hairline above it,
                so the pair scans as two statements in one surface. */}
            <View
              testID="as-storage"
              style={styles.storageRow}
              accessible
              accessibilityLabel="Offline storage. All configurations are saved locally and work offline."
            >
              <Icon name="lock" size={16} color={theme.glass.onGlassVariant} />
              <View style={styles.noteLockBody}>
                <Text style={styles.noteLockLabel}>OFFLINE STORAGE</Text>
                <Text style={styles.noteLockText}>
                  All configurations are saved locally and work offline.
                </Text>
              </View>
            </View>
          </GlassCard>
        </ScrollView>
      </SectionChrome>
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.glass.backdrop },

    // ONE column, ONE gutter — 20px, the same edge the chrome's own padding
    // resolves to; the shipped 16 put every card 4px left of the back pill.
    column: {
      width: '100%',
      maxWidth: maxContentWidth,
      alignSelf: 'center',
      paddingHorizontal: space(5),
      paddingTop: space(5),
    },

    // ── the failure branch, and only the failure branch ──
    msg: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 14,
      paddingHorizontal: space(4),
      borderRadius: radius.large,
      borderWidth: 1,
      borderColor: theme.palette.error,
      backgroundColor: theme.palette.errorContainer,
    },
    msgText: { ...type.bodyMedium, color: theme.palette.onErrorContainer, flex: 1 },

    // ── APPEARANCE ──
    heading: {
      ...type.labelSmall,
      color: theme.glass.onGlassVariant,
      marginBottom: space(3),
    },
    modes: { gap: space(3) },
    // 76px tall, 12/14 padding — the file's own recipe. Both states 1px so
    // choosing a mode cannot resize the pair. A RESTING option is a glass
    // card, not a hairline box: the tint, a lit lip and the shared card depth,
    // so the two options read as panels rather than radio outlines — but the
    // boundary is --outline, the 3:1 non-text floor the reference chose over
    // the shipped screen's 1.7:1 hairline.
    option: {
      minHeight: 76,
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(3),
      paddingVertical: space(3),
      paddingHorizontal: 14,
      borderRadius: radius.large,
      borderWidth: 1,
      borderColor: theme.palette.outline,
      backgroundColor: theme.glass.tint,
      ...cardShadow,
    },
    // The chosen option goes SOLID: the accent fills the whole panel and every
    // piece of text on it turns to on-primary. This replaces a pale
    // primary-container wash, which read as "slightly tinted" rather than as
    // "this is the mode you are in" — the question the tap is answering.
    //
    // `primarySolid`, not `primary`: white on `primary` (#E65100) is 3.79:1,
    // which is fine for the 20px+ display roles and for icons and short of the
    // 4.5:1 a 15px title and a 12px sub line owe. `primarySolid` (#C2410C) is
    // the same hue a step deeper and clears 5.2:1 with white — and it is the
    // same step in both palettes, so the selected row looks identical in
    // either mode.
    //
    // Every child inverts with it — chip, title, sub and mark — because a
    // single accent-coloured piece left on a solid accent would disappear.
    // Border width stays 1px in both states, so choosing a mode cannot resize
    // the pair and shift the layout under the tap.
    optionSelected: {
      borderColor: theme.palette.primarySolid,
      backgroundColor: theme.palette.primarySolid,
    },
    pressed: { opacity: 0.88 },
    chip: {
      width: 44,
      height: 44,
      borderRadius: radius.medium,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.palette.tertiaryContainer,
      flexShrink: 0,
    },
    // The chip inverts with the panel: a light chip carrying the accent icon,
    // so it stays legible on the solid fill instead of dissolving into it.
    chipSelected: { backgroundColor: onPrimarySolid },
    optionBody: { flex: 1, minWidth: 0 },
    optionTitle: {
      ...type.titleMedium,
      color: theme.glass.onGlass,
    },
    optionTitleSelected: { color: onPrimarySolid },
    optionSub: {
      ...type.bodySmall,
      color: theme.glass.onGlassVariant,
      marginTop: 2,
    },
    optionSubSelected: { color: onPrimarySolid },
    // 20px ring: the selection mark the shipped screen never had. Rest is a
    // plain --outline ring; chosen fills with on-primary and knocks the tick
    // out in primary — inverting with the panel, so the tick reads on the
    // solid fill rather than matching it.
    mark: {
      width: 20,
      height: 20,
      borderRadius: radius.full,
      borderWidth: 1.5,
      borderColor: theme.palette.outline,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    markSelected: {
      borderColor: onPrimarySolid,
      backgroundColor: onPrimarySolid,
    },

    // ── the commit caption ──
    commitHint: {
      ...type.bodySmall,
      color: theme.glass.onGlassVariant,
      marginTop: space(3),
    },

    // ── HOW THIS SAVES ──
    // Carded like the sections above it; the heading is its first child, so
    // the 20 lives on the column and not on the heading. The reference insets
    // it 16/18 — the note padding, not the column's 20.
    howCard: { marginTop: space(5), paddingVertical: space(4), paddingHorizontal: 18 },
    howList: { gap: space(3) },
    howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space(2.5) },
    howBody: { ...type.bodyMedium, color: theme.glass.onGlassVariant, flex: 1 },
    howLead: { fontFamily: 'Poppins_600SemiBold', color: theme.glass.onGlass },

    // ── the offline statement, as the how-card's last line ──
    // One card, two statements: a hairline separates the pair so they still
    // scan as two facts, not one blob. No fill of its own.
    storageRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space(2),
      marginTop: 18,
      paddingTop: space(4),
      borderTopWidth: 1,
      borderTopColor: theme.palette.outlineVariant,
    },
    noteLockBody: { flex: 1 },
    noteLockLabel: { ...type.labelSmall, color: theme.glass.onGlassVariant },
    noteLockText: {
      ...type.bodySmall,
      color: theme.glass.onGlassVariant,
      marginTop: space(1),
    },
  });
