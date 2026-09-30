import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { getTheme, type KonduktTheme, type ThemeMode } from '../theme';

/**
 * The root-owned theme.
 *
 * The spec is explicit: the theme propagates from the app root, never from
 * inside the Settings screen. `App.tsx` loads the persisted mode before first
 * paint and renders this provider; the Settings screen asks it to change the
 * mode, and nothing else touches it.
 *
 * Context is necessary here rather than a prop drilled through HomeScreen —
 * the mode must be reachable from a screen nested four sections deep without
 * threading a prop through every screen in between. It is read with the
 * `useKonduktTheme` hook, which throws if used outside the provider so a
 * miswired tree fails loudly in development instead of silently staying light.
 */
const KonduktThemeContext = createContext<{
  theme: KonduktTheme;
  setThemeMode: (mode: ThemeMode) => void;
} | null>(null);

export function KonduktThemeProvider({
  initialMode,
  children,
}: {
  initialMode: ThemeMode;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  // One stable object per mode: consumers re-render only when the mode
  // actually flips, not when the provider re-renders for any other reason.
  const theme = useMemo(() => getTheme(mode), [mode]);

  const value = useMemo(
    () => ({ theme, setThemeMode: (next: ThemeMode) => setMode(next) }),
    [theme],
  );
  return <KonduktThemeContext.Provider value={value}>{children}</KonduktThemeContext.Provider>;
}

/** The current theme bundle and the root-only mode setter. */
export function useKonduktTheme(): { theme: KonduktTheme; setThemeMode: (mode: ThemeMode) => void } {
  const context = useContext(KonduktThemeContext);
  if (!context) {
    throw new Error('useKonduktTheme must be used inside KonduktThemeProvider');
  }
  return context;
}
