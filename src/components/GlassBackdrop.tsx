import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useKonduktTheme } from '../lib/themeContext';

/**
 * The field every glass panel refracts — one fixed warm-to-cool wash.
 *
 * Copied from the reference's `.field`, which is a single element:
 *
 *   background: linear-gradient(135deg, #FBC9A8 0%, #F4F7FB 52%, #C6D9E8 100%)
 *
 * The three stops are the theme's own tokens (`glass.fieldTopLeft[0]` →
 * `glass.backdrop` at 52% → `glass.fieldBottomRight[0]`), so the dark bundle
 * draws the same shape from a warm dark corner through the page to a cool one
 * without a second code path.
 *
 * Rendered ONCE at the app root, behind every screen: the reference keeps its
 * field pinned while the app's inner container does the scrolling, so panels
 * slide *over* the wash instead of dragging it. This replaced two oversized
 * flat circles per screen, whose visible edges were the reason the page read as
 * two pale blobs rather than one field.
 */
export function GlassBackdrop() {
  const { theme } = useKonduktTheme();
  const { glass } = theme;

  return (
    <LinearGradient
      pointerEvents="none"
      colors={
        [glass.fieldTopLeft[0], glass.backdrop, glass.fieldBottomRight[0]] as const
      }
      locations={[0, 0.52, 1] as const}
      // 135°: warm at the top-left corner, cool at the bottom-right.
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}
