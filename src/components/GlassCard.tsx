import { useMemo, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { cardShadow, radius, type KonduktTheme } from '../theme';
import { useKonduktTheme } from '../lib/themeContext';

/**
 * Liquid glass surface.
 *
 * The target effect (inner shadow blur 15 / spread -5, glass tint fully
 * transparent, frost blur 0, noise 0.008 @ 77) is described in shader terms —
 * an inner light-bleed and a per-pixel grain that React Native's style system
 * has no primitive for. What is reproduced here, and how:
 *
 * - innerShadowColor white, blur 15, spread -5 → a bright inner top edge over a
 *   soft outer shadow. The negative spread is what makes the light hug the rim
 *   instead of glowing from the centre; an inset ring gives the same read.
 * - glassTintColor transparent, glassTintOpacity 0 → BlurView tintIntensity 0,
 *   so the surface contributes no colour of its own and only refracts.
 * - frostBlurRadius 0 → a crisp blur, no diffusion.
 * - noiseFrequency 0.008, noiseStrength 77 → a flat low-opacity wash. True
 *   per-pixel grain needs a shader; this approximates its visual weight only.
 *
 * `intensity` is how hard the blur bites, mapped from frostBlurRadius. Keep it
 * low to stay crisp; raise it toward 40 to frost.
 *
 * **The glass tokens are read from the theme, not imported as constants.**
 * This card used to read the light `glass` object at module scope and hard-code
 * `tint="light"` on the blur, which froze every panel in the app to the light
 * palette: in Dark mode a card painted its light tint — a pale panel floating
 * on a dark backdrop — because the tokens it needed were right there in
 * `darkGlass` and never consulted. Reading `theme.glass` costs one render and
 * is the whole difference between a surface that belongs to the mode it is in
 * and one that does not.
 */
export function GlassCard({
  children,
  style,
  intensity = 0,
  cornerRadius = radius.glass,
  tint,
  rim,
  onPress,
  hitSlop,
  pointerEvents,
  ...rest
}: {
  /** Optional: a card used only as a tinted FILL under a Pressable's own
   *  content carries no children of its own. */
  children?: ReactNode;
  /** Accepts the same array form as any RN style prop, so a caller can pass
   *  conditional styles without wrapping them in `StyleSheet.flatten`. */
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  /**
   * Drives the rim as well as the root, or the lit edge would keep the default
   * 28px corner inside a card rounded to something else and read as a ring
   * poking out of it. The default is the app's glass shape; a ledger row asks
   * for the tighter one its reference uses.
   */
  cornerRadius?: number;
  /**
   * Coloured glass: an accent fill under the same blur and grain. A filled
   * control passes `tintedGlass.accent` here instead of painting a flat
   * rectangle, so it is rendered as glass rather than as a swatch.
   */
  tint?: string;
  /** The lit edge's colour, for a card whose rim must read against its own fill. */
  rim?: string;
  /**
   * Makes the card the button. Pressing fades the whole surface rather than
   * repainting it, because a translucent pane has no "darker" step to go to.
   */
  onPress?: PressableProps['onPress'];
  /** Carried through to the pressable surface, so a button keeps its tap area. */
  hitSlop?: PressableProps['hitSlop'];
  /**
   * A card used only as a FILL under a Pressable's own content passes "none"
   * here: the blur layer would otherwise be a touch target in its own right.
   */
  pointerEvents?: ViewProps['pointerEvents'];
} & Pick<
  ViewProps,
  | 'accessible'
  | 'accessibilityLabel'
  | 'accessibilityHint'
  | 'accessibilityRole'
  | 'accessibilityLiveRegion'
  | 'accessibilityState'
  | 'testID'
>) {
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // The blur tints whatever it samples, so it has to follow the mode: a light
  // tint over a dark backdrop washes the panel out to grey.
  const blurTint = theme.mode === 'dark' ? 'dark' : 'light';

  const body = (
    <>
      {/* Blur is the only thing here that samples what is behind the card, so
          it must sit directly on the backdrop, under every other layer. */}
      <BlurView
        intensity={intensity}
        tint={blurTint}
        // The spec calls for a fully transparent glass tint — let the backdrop
        // come through untouched.
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      {/* Grain. Flat rather than per-pixel; see the note above. */}
      <View style={styles.noise} pointerEvents="none" />
      {children}
      {/* The lit edge goes on last so it reads as a highlight *over* the panel,
          not a border behind the content. */}
      <View
        style={[
          styles.innerRim,
          { borderRadius: cornerRadius, borderColor: tint ? 'transparent' : rim ?? theme.glass.rim },
        ]}
        pointerEvents="none"
      />
    </>
  );

  const surface = [
    styles.root,
    tint ? { backgroundColor: tint } : null,
    { borderRadius: cornerRadius },
    style,
  ];

  return onPress ? (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop}
      pointerEvents={pointerEvents}
      style={({ pressed }) => [surface, pressed && styles.pressed]}
      {...rest}
    >
      {body}
    </Pressable>
  ) : (
    <View style={surface} pointerEvents={pointerEvents} {...rest}>
      {body}
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
    root: {
      overflow: 'hidden',
      borderRadius: radius.glass,
      backgroundColor: theme.glass.tint,
      // Shared with every filled card on the page, so a panel can't end up at a
      // depth its neighbours aren't at. See `cardShadow`. The geometry is the
      // shared token; only the shadow's COLOUR follows the mode — light's token
      // bakes in a light `glass.shadow`, and casting a light shadow from a dark
      // panel is what makes a dark surface look pasted on.
      ...cardShadow,
      shadowColor: theme.glass.shadow,
    },
    innerRim: {
      // absoluteFill, not absoluteFillObject: RN 0.86's types no longer declare
      // the latter. They are the same frozen style object, and absoluteFill is
      // still typed and still present at runtime.
      ...StyleSheet.absoluteFill,
      borderRadius: radius.glass,
      // The white bleed along the lit edge — the -5 spread means it stops well
      // short of the centre, so a 1px ring reads correctly and costs nothing.
      borderWidth: 1,
    },
    noise: {
      ...StyleSheet.absoluteFill,
      backgroundColor: theme.glass.grain,
      opacity: 0.035,
    },
    pressed: { opacity: 0.88 },
  });
