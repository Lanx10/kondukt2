import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Poppins_400Regular,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { HomeScreen } from './src/screens/HomeScreen';
import { GlassBackdrop } from './src/components/GlassBackdrop';
import { palette } from './src/theme';
import { loadThemeMode } from './src/lib/preferences';
import { installWebScrollGuards } from './src/lib/webScroll';
import { KonduktThemeProvider, useKonduktTheme } from './src/lib/themeContext';
import { UpdateProvider } from './src/lib/UpdateProvider';

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
    return <View style={{ flex: 1, backgroundColor: palette.background }} />;
  }

  return (
    <KonduktThemeProvider initialMode={themeMode}>
      <SafeAreaProvider>
        {/* One update checker for the whole app: owns the throttled
            start/foreground OTA checks and the Settings update state. It
            renders no UI of its own, so it wraps the tree without touching
            the layout. */}
        <UpdateProvider>
          <Root />
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
    <View style={[styles.root, { backgroundColor: theme.glass.backdrop }]}>
      <GlassBackdrop />
      <HomeScreen />
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
