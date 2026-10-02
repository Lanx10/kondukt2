import { useEffect, useMemo, useState } from 'react';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Poppins_400Regular,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { HomeScreen } from './src/screens/HomeScreen';
import { GlassBackdrop } from './src/components/GlassBackdrop';
import { getTheme, space, type, type KonduktTheme } from './src/theme';
import { loadThemeMode } from './src/lib/preferences';
import { installWebScrollGuards } from './src/lib/webScroll';
import { KonduktThemeProvider, useKonduktTheme } from './src/lib/themeContext';
import { UpdateProvider } from './src/lib/UpdateProvider';
import { ApkUpdateProvider } from './src/lib/ApkUpdateProvider';

export default function App() {
  // The .ttf files ship inside the package and load from disk, so this needs no
  // network access. Holding the first paint until they are ready stops the UI
  // rendering once in the system font and then snapping to Poppins.
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  // The persisted theme is read at app entry so the first paint is the last
  // selected mode — no flash of light before dark. Storage failures resolve
  // to null and the app stays in its light default.
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | null>(null);
  // The page must not scroll or bounce around the app frame — see the module.
  // Runs before the first paint that matters, and is a no-op on native.
  useEffect(() => {
    installWebScrollGuards();
  }, []);
  useEffect(() => {
    let cancelled = false;
    void loadThemeMode().then((mode) => {
      if (!cancelled) setThemeMode(mode ?? 'light');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!fontsLoaded || themeMode === null) {
    // `getTheme` rather than the light `palette.background` this used to read:
    // App sits ABOVE the provider, so it cannot use the hook, but it already
    // holds the persisted mode — a dark-mode user was getting a white flash on
    // every cold start, for as long as the fonts took to load.
    return <View style={{ flex: 1, backgroundColor: getTheme(themeMode ?? 'light').palette.background }} />;
  }

  return (
    <KonduktThemeProvider initialMode={themeMode}>
      <SafeAreaProvider>
        {/* Two update checkers for the whole app: the APK updater (GitHub
            Releases — the primary, installable-binary channel) and the OTA
            provider (JS-only interface updates). Each owns its own throttled
            start/foreground check and Settings state; neither renders UI, so
            they wrap the tree without touching the layout. */}
        <UpdateProvider>
          <ApkUpdateProvider>
            <Root />
          </ApkUpdateProvider>
        </UpdateProvider>
      </SafeAreaProvider>
    </KonduktThemeProvider>
  );
}

/**
 * Reads the theme one level inside the provider so the status bar can follow
 * the mode: dark content on a light page, light content on a dark one.
 */
function Root() {
  const { theme } = useKonduktTheme();
  return (
    // The field lives here, once, behind every screen: the reference pins it to
    // the frame so the panels slide over it. A screen that painted its own copy
    // inside its scroll container dragged the gradient along with the content.
    <View style={[baseStyles.root, { backgroundColor: theme.glass.backdrop }]}>
      <GlassBackdrop />
      <HomeScreen />
      {/* Last in the frame, so it sits over every screen; sheets are Modals
          and stay above it. One line, never interactive. */}
      <AppCredit />
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}

/** The byline pinned to the bottom of every screen. */
function AppCredit() {
  const insets = useSafeAreaInsets();
  const { theme } = useKonduktTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityRole="text"
      accessibilityLabel="Developed by Lanx | Laurence Gongora"
      style={[
        baseStyles.credit,
        // The same field the frame behind the screens paints: content scrolls
        // under the line instead of tangling with it.
        { backgroundColor: theme.glass.backdrop, paddingBottom: insets.bottom + space(1.5) },
      ]}
    >
      <Text style={styles.creditText}>Developed by Lanx | Laurence Gongora</Text>
    </View>
  );
}

/**
 * Geometry only — no colour tokens, so these stay module-level and neither
 * `App` nor `Root` has to build a stylesheet it does not need.
 */
const baseStyles = StyleSheet.create({
  root: { flex: 1 },
  credit: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: space(4),
    paddingTop: space(1),
  },
});

/**
 * The byline's own text colour, built from the theme.
 *
 * The bar's BACKGROUND was already theme-aware while its TEXT read the light
 * `palette` at module scope, so in Dark mode this pinned line rendered as dark
 * grey on the dark backdrop — 1.93:1, on every screen in the app, because the
 * credit sits outside the screen's own chrome. The split is the whole bug: half
 * the component followed the mode and half did not.
 */
const makeStyles = (theme: KonduktTheme) =>
  StyleSheet.create({
    creditText: {
      ...type.bodySmall,
      color: theme.palette.onSurfaceVariant,
      textAlign: 'center',
    },
  });
