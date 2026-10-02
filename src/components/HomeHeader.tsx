import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { radius, space, type, type KonduktTheme } from '../theme';

import { useThemedStyles } from '../lib/useThemedStyles';

/**
 * The app's one header: mark, wordmark, and a tagline that states what the app
 * is doing.
 *
 * The tagline is the point. A fixed subtitle ("Smart fare control") is true
 * every second and therefore says nothing; these five lines are mutually
 * exclusive, so at any moment exactly one of them is the reason the user opened
 * the app — reading records, a running trip, nothing recorded, or ready.
 *
 * The pill carries the live trip's number and elapsed time, and is the only
 * moving element in the app: a slow opacity pulse, driven natively, off when
 * the system asks for reduced motion.
 */
export function HomeHeader({ tagline, tripLabel }: { tagline: string; tripLabel?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.root}>
      {/* The favicon itself, bare — no badge card behind it. */}
      <Image
        source={require('../../assets/favicon.png')}
        style={styles.mark}
        accessible
        accessibilityRole="image"
        accessibilityLabel="Kondukt app icon"
      />
      <View style={styles.text}>
        <Text style={styles.wordmark} accessibilityRole="header" numberOfLines={1}>
          KONDUKT
        </Text>
        <Text style={styles.tagline} numberOfLines={1}>
          {tagline}
        </Text>
      </View>
      {tripLabel ? <TripPill label={tripLabel} /> : null}
    </View>
  );
}

/** The live-trip pill, and its pulse. */
function TripPill({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles);
  // useState, not useRef: an Animated.Value is a value, and reading a ref's
  // `.current` during render is what the compiler lint rule refuses.
  const [pulse] = useState(() => new Animated.Value(1));
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    if (reducedMotion) return;
    // A slow breath, not a blink: the dot marks "this is live" and a hard flash
    // would read as an alert.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);

  return (
    <View style={styles.pill} accessible accessibilityLabel={`Trip in progress. ${label}`}>
      <Animated.View style={[styles.dot, reducedMotion ? null : { opacity: pulse }]} />
      <Text style={styles.pillLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(5),
    paddingTop: space(3),
    paddingBottom: space(2),
  },
  mark: {
    width: 48,
    height: 48,
    // The reference's 14, not medium's 12 — see `radius.brand`.
    borderRadius: radius.brand,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  // Poppins caps are wide; positive tracking opened the letters into gaps.
  // Pull it back so KONDUKT reads as one word again.
  wordmark: {
    ...type.headlineSmall,
    color: theme.palette.onSurface,
    letterSpacing: 0.2,
  },
  tagline: {
    ...type.bodySmall,
    color: theme.palette.onSurfaceVariant,
    marginTop: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    height: 32,
    paddingHorizontal: space(3),
    borderRadius: radius.full,
    backgroundColor: theme.accent.secondary.container,
    flexShrink: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: theme.accent.secondary.fg,
  },
  pillLabel: {
    ...type.labelSmall,
    color: theme.accent.secondary.onContainer,
  },
});
