import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useKonduktTheme } from '../lib/themeContext';
import { resolveFieldStops } from '../theme/appearance';

/**
 * The field every glass panel refracts — one warm-to-cool wash.
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
 * WHAT THIS READS. The bundle's `semantic.backgroundGradient`, not the three
 * tokens directly: that descriptor is the same one the Advanced Appearance
 * axes resolve into, so the Background, Intensity and Direction controls paint
 * through the app's root element instead of quietly changing a token nothing is
 * drawn with. At the default appearance it resolves to exactly the three
 * literals above at 135°, which is why an untouched install renders the
 * reference field unchanged. The stops and the vectors are handed to
 * `resolveFieldStops`, which is shared with the settings screen's swatches so a
 * control cannot preview a field different from the one on screen.
 *
 * Rendered ONCE at the app root, behind every screen: the reference keeps its
 * field pinned while the app's inner container does the scrolling, so panels
 * slide *over* the wash instead of dragging it. This replaced two oversized
 * flat circles per screen, whose visible edges were the reason the page read as
 * two pale blobs rather than one field.
 */
export function GlassBackdrop() {
  const { theme } = useKonduktTheme();
  const { backgroundGradient } = theme.semantic;

  return (
    <LinearGradient
      pointerEvents="none"
      colors={resolveFieldStops(backgroundGradient)}
      // 52%: the page's own colour holds the middle third of the field, which
      // is the reference's placement and what keeps a card legible over it.
      locations={[0, 0.52, 1] as const}
      // 135° by default — warm at the top-left corner, cool at the bottom-right
      // — and whatever the Direction axis currently asks for.
      start={backgroundGradient.start}
      end={backgroundGradient.end}
      style={StyleSheet.absoluteFill}
    />
  );
}
