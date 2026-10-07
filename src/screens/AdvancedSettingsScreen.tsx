import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassCard } from '../components/GlassCard';
import { SectionChrome } from '../components/SectionChrome';
import { Icon, type IconName } from '../icons';
import {
  cardShadowFor,
  DEFAULT_THEME_ID,
  getThemeBundle,
  maxContentWidth,
  radius,
  resolveFieldStops,
  space,
  type,
  THEME_REGISTRY,
  type Appearance,
  type KonduktTheme,
  type ThemeMode,
  type ThemeSpec,
} from '../theme';
import { useKonduktTheme } from '../lib/themeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import {
  loadThemeId,
  loadThemeMode,
  saveThemeId,
  saveThemeMode,
} from '../lib/preferences';

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
 * A theme's field, as the app actually paints it RIGHT NOW.
 *
 * Not the theme's declared gradient: it is that gradient resolved through the
 * bundle in the CURRENT mode and under the CURRENT appearance, which is the
 * honest answer on both counts. A dark-dialect theme's stops are re-toned when
 * it is rendered in Light mode, so the raw declaration would put a near-black
 * swatch on a light card; and the Background, Intensity and Direction axes are
 * drawn by `GlassBackdrop` from the same descriptor, so a swatch that ignored
 * them would preview a field that is not the one behind the screen.
 *
 * `resolveFieldStops` is shared with the backdrop for that reason: the swatch
 * and the page are two answers to one question, and they cannot disagree.
 */
function paintedField(id: string, mode: ThemeMode, appearance: Appearance) {
  const { backgroundGradient } = getThemeBundle(id, mode, appearance).semantic;
  return {
    colors: resolveFieldStops(backgroundGradient),
    start: backgroundGradient.start,
    end: backgroundGradient.end,
  };
}

/**
 * The screen's own option row - ONE row, for a mode, an appearance value and a
 * toggle alike.
 *
 * It was two rows once: the mode cards were inline markup and the appearance
 * values got a component, so the same six styles were written twice in this
 * file and could drift. Every one of those options is the same question - pick
 * one of these, or turn this on - asked with a chip, a title, a line of
 * consequence and a 20px mark, so it is one row now and the mode block above
 * calls it like any other.
 *
 * The only thing that varies is the role it reports: `radio` for a choice
 * between values, `switch` for a flag, because "on or off" is a different
 * question to a screen reader than "which of these three". The mark answers
 * both the same way.
 */
function OptionRow({
  label,
  sub,
  icon,
  selected,
  onPress,
  testID,
  role = 'radio',
}: {
  label: string;
  sub: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  /** Optional: the mode rows are identified by their group, not individually. */
  testID?: string;
  role?: 'radio' | 'switch';
}) {
  const { theme } = useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={`${label}. ${sub}`}
      // `aria-checked` DIRECTLY: react-native-web 0.21 forwards aria-* props to
      // the DOM and drops `accessibilityState`, while RN core merges the aria
      // prop into the native state — both platforms get the state from this
      // one prop, and the second rides along as the native-side belt.
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
          name={icon}
          size={22}
          color={selected ? theme.palette.primarySolid : theme.palette.onTertiaryContainer}
        />
      </View>
      <View style={styles.optionBody}>
        <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>{label}</Text>
        <Text style={[styles.optionSub, selected && styles.optionSubSelected]}>{sub}</Text>
      </View>
      {/* Decorative, as on the mode cards: the label and the checked state
          already say it to a reader. */}
      <View
        style={[styles.mark, selected && styles.markSelected]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {selected ? <Icon name="check" size={13} color={theme.palette.primarySolid} /> : null}
      </View>
    </Pressable>
  );
}

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
  const { theme, themeId, setThemeMode, setThemeId } =
    useKonduktTheme();
  const styles = useThemedStyles(makeStyles);
  const { width: windowWidth } = useWindowDimensions();

  // Two columns once the column is wide enough to carry two readable cards,
  // one below that. Measured from the COLUMN, not the window: the column stops
  // at `maxContentWidth`, so on a tablet the extra room is gutter, not card.
  const contentWidth = Math.min(windowWidth, maxContentWidth) - space(5) * 2;
  const columns = contentWidth >= 300 ? 2 : 1;

  // Every theme's field in the current mode. Memoised on the mode alone, so a
  // tap re-renders this screen once and does not rebuild eleven bundles again
  // for the cards that did not change.
  const previews = useMemo(
    () =>
      THEME_REGISTRY.map((spec: ThemeSpec) => ({
        spec,
        field: paintedField(spec.id, theme.mode, theme.appearance),
      })),
    [theme.mode, theme.appearance],
  );

  // The failure copy, or null. The happy path never renders a message.
  const [error, setError] = useState<string | null>(null);
  // The painted mode, readable synchronously: a second tap inside one frame
  // must no-op against what is ON SCREEN, not against the context value the
  // closure still holds.
  const modeRef = useRef<ThemeMode>(theme.mode);
  // The selected id, readable synchronously, for the same reason the mode is:
  // a second tap inside one frame must no-op against what is ON SCREEN.
  const themeIdRef = useRef<string>(themeId);
  // The write chain: sequential by construction, last tap wins. Shared by the
  // mode and the theme, so a tap on one and a tap on the other cannot land out
  // of order against the same store.
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

  /**
   * The theme commit. Same contract as the mode commit above, for the same
   * reasons: the paint is optimistic because the answer to a theme tap IS the
   * theme, and a refused write reverts to the id read back from storage rather
   * than to the one this session remembers.
   */
  const commitTheme = useCallback(
    (next: string) => {
      if (next === themeIdRef.current) return; // the chosen card is a no-op
      themeIdRef.current = next;
      setError(null);
      setThemeId(next);

      chainRef.current = chainRef.current
        .then(() => saveThemeId(next))
        .then((ok) => {
          if (ok) return;
          return loadThemeId().then((stored) => {
            const onDisk = stored ?? DEFAULT_THEME_ID;
            themeIdRef.current = onDisk;
            setThemeId(onDisk);
            const name = THEME_REGISTRY.find((t) => t.id === onDisk)?.name ?? 'the default theme';
            setError(
              `Kondukt could not save that theme, so the screen is back on ${name}. ` +
                'Nothing was lost — tap again to retry.',
            );
          });
        });
    },
    [setThemeId],
  );

  const currentSpec = THEME_REGISTRY.find((spec) => spec.id === themeId) ?? THEME_REGISTRY[0];
  const subtitle = `${currentSpec.name} · ${theme.mode === 'dark' ? 'Dark' : 'Light'} mode`;

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
              {OPTIONS.map((option) => (
                <OptionRow
                  key={option.mode}
                  label={option.label}
                  sub={option.sub}
                  icon={option.icon}
                  selected={theme.mode === option.mode}
                  onPress={() => commit(option.mode)}
                />
              ))}
            </View>

            <Text testID="as-commit" style={styles.commitHint}>
              Applies the moment you tap it. There is nothing to save.
            </Text>
          </View>

          {/* ── THEMES ────────────────────────────────────────────────────
              Below the appearance control, not inside it: the mode and the
              theme are two different answers, and a driver picking a palette
              should not have to reason about which half of the screen it is
              in. One column, the same 20px gutter and the same heading rhythm
              as APPEARANCE above. */}
          <View testID="as-themes" style={styles.themes}>
            <Text accessibilityRole="header" style={styles.heading}>
              THEMES
            </Text>

            {/* Every theme in the registry, the app's own first. Just colour
                choices: each card shows the theme's field and nothing else.
                `kondukt` is listed rather than omitted so you can always get
                back to the shipped look. */}
            <View style={styles.themeGrid}>
              {previews.map(({ spec, field }) => {
                const selected = themeId === spec.id;
                const builtForDark = spec.dialect === 'dark';
                const dark = builtForDark ? 'Dark' : 'Light';
                return (
                  <Pressable
                    key={spec.id}
                    testID={`as-theme-${spec.id}`}
                    onPress={() => commitTheme(spec.id)}
                    accessibilityRole="radio"
                    accessibilityLabel={`${spec.name}. ${spec.note}. Built for ${dark.toLowerCase()} mode.`}
                    aria-checked={selected}
                    accessibilityState={{ checked: selected }}
                    style={({ pressed }) => [
                      styles.themeCard,
                      columns === 2 ? styles.themeCardHalf : styles.themeCardFull,
                      selected && styles.themeCardSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <LinearGradient
                      colors={field.colors}
                      start={field.start}
                      end={field.end}
                      style={styles.themeSwatch}
                    >
                      {/* The same 20px mark the mode cards use, so selection
                          reads identically in both halves of the screen. */}
                      <View
                        style={[styles.mark, styles.themeMark, selected && styles.markSelected]}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        {selected ? (
                          <Icon name="check" size={13} color={theme.palette.primarySolid} />
                        ) : null}
                      </View>
                    </LinearGradient>
                  </Pressable>
                );
              })}
            </View>

            <Text testID="as-themes-hint" style={styles.commitHint}>
              The whole app changes as you tap, background included.
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
      ...cardShadowFor(theme),
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
    chipSelected: { backgroundColor: theme.onPrimarySolid },
    optionBody: { flex: 1, minWidth: 0 },
    optionTitle: {
      ...type.titleMedium,
      color: theme.glass.onGlass,
    },
    optionTitleSelected: { color: theme.onPrimarySolid },
    optionSub: {
      ...type.bodySmall,
      color: theme.glass.onGlassVariant,
      marginTop: 2,
    },
    optionSubSelected: { color: theme.onPrimarySolid },
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
      borderColor: theme.onPrimarySolid,
      backgroundColor: theme.onPrimarySolid,
    },

    // ── THEMES ──
    // The same 20 that separates the two sections above and below, so the
    // screen keeps one rhythm rather than gaining a second one.
    themes: { marginTop: space(5) },

    // The current theme's field. The gradient is a child rather than a
    // background so it can be clipped by the same `overflow: hidden` the mode
    // cards use, and so the panel can keep the shared card depth.
    preview: {
      overflow: 'hidden',
      borderRadius: radius.large,
      borderWidth: 1,
      borderColor: theme.palette.outline,
      backgroundColor: theme.glass.tint,
      ...cardShadowFor(theme),
    },
    // 56 tall: tall enough for the three stops to read as a field rather than
    // as a hairline, short enough that the eleven cards below stay on one
    // screen on a handset.
    previewField: { height: 56, width: '100%' },
    previewBody: { padding: space(4) },
    previewName: { ...type.titleMedium, color: theme.glass.onGlass },
    previewNote: { ...type.bodySmall, color: theme.glass.onGlassVariant, marginTop: 2 },

    // A wrapping row rather than a FlatList: eleven cards is a static list on
    // a screen that already scrolls.
    themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3) },

    // The mode card's own part - glass tint, lit lip, 1px border in BOTH
    // states, the shared card depth - stacked rather than laid out in a row.
    // A row at this width leaves the name about 60px, which truncated "Cyber
    // Summer Night" to "Cy..."; a swatch above the name gives the name the
    // whole card.
    themeCard: {
      overflow: 'hidden',
      borderRadius: radius.large,
      borderWidth: 1,
      borderColor: theme.palette.outline,
      backgroundColor: theme.glass.tint,
      ...cardShadowFor(theme),
    },
    // FLEX-BASIS, NOT A COMPUTED PIXEL WIDTH, and the reason is arithmetic that
    // cannot be won. Two cards plus the 12px gap have to fit inside the column
    // or flex wrap drops the second card onto its own line, which turned a
    // two-column grid into eleven stacked rows at every viewport whose column
    // was not an even number of pixels - and the widths that look fine are the
    // ones that hide it. A basis of 48% with room to grow lets flexbox do the
    // division: it always fits, and it fills the row rather than leaving a
    // slack pixel at the right edge.
    themeCardHalf: { flexBasis: '48%', flexGrow: 1, maxWidth: '49%' },
    themeCardFull: { flexBasis: '100%', maxWidth: '100%' },

    // Chosen goes SOLID, exactly as a chosen mode does, so selection means the
    // same thing in both halves of the screen. The border stays 1px in both
    // states so choosing cannot resize the grid and shift it under the tap.
    themeCardSelected: {
      borderColor: theme.palette.primarySolid,
      backgroundColor: theme.palette.primarySolid,
    },
    // The swatch IS the card: no name, no note, just the colour field.
    themeSwatch: { width: '100%', height: 72 },
    // On the swatch rather than beside it. It carries its own solid backing so
    // it reads on a pale field and a dark one alike.
    themeMark: {
      position: 'absolute',
      top: 8,
      right: 8,
      backgroundColor: theme.glass.tint,
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
