import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  getThemeBundle,
  DEFAULT_APPEARANCE,
  DEFAULT_THEME_ID,
  type Appearance,
  type KonduktTheme,
  type ThemeMode,
} from '../theme';

/**
 * The root-owned theme.
 *
 * The spec is explicit: the theme propagates from the app root, never from
 * inside the Settings screen. `App.tsx` loads the persisted mode, the
 * persisted theme id AND the persisted appearance before first paint and
 * renders this provider; the Settings screen asks it to change any of them, and
 * nothing else touches it.
 *
 * WHAT THE PROVIDER OWNS. Three values, all persisted, all of them what the
 * user chose: the MODE (light or dark), the THEME ID (which entry of the
 * registry) and the APPEARANCE (the seven Advanced Appearance axes, which say
 * how the chosen theme is drawn rather than which theme it is). The bundle is
 * derived from the three by the registry rather than stored, so there is
 * exactly one place a bundle can come from and no way for the mode, the palette
 * and the way it is drawn to disagree.
 *
 * WHY THE ID IS NOT A THEME OBJECT. A component must never hold a snapshot of
 * a palette. Holding the id means the whole tree resolves it on every render,
 * and `getThemeBundle` is memoised on `[themeId, mode, appearance]`, so a tap
 * re-renders once and a provider re-render for any other reason does not
 * re-render a single consumer. The same argument is why the appearance is held
 * as the seven values it is made of rather than as a derived bundle: a screen
 * reads `theme.appearance` to show what is currently chosen and builds the next
 * one from it.
 *
 * Context is necessary here rather than a prop drilled through HomeScreen —
 * the theme must be reachable from a screen nested four sections deep without
 * threading a prop through every screen in between. It is read with the
 * `useKonduktTheme` hook, which throws if used outside the provider so a
 * miswired tree fails loudly in development instead of silently staying light.
 */
const KonduktThemeContext = createContext<{
  theme: KonduktTheme;
  /** The registry id currently selected. */
  themeId: string;
  /** The seven appearance axes currently selected. */
  appearance: Appearance;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeId: (id: string) => void;
  setAppearance: (appearance: Appearance) => void;
} | null>(null);

export function KonduktThemeProvider({
  initialMode,
  initialThemeId,
  initialAppearance,
  children,
}: {
  initialMode: ThemeMode;
  /** Defaults to the registry's own default, so a caller that has not loaded a
   *  preference yet still resolves a real bundle rather than nothing. */
  initialThemeId?: string;
  /** The loaded appearance, filled from `DEFAULT_APPEARANCE` for every axis the
   *  store does not hold. Optional for the same reason `initialThemeId` is: a
   *  caller that has not loaded a preference yet must still resolve a bundle. */
  initialAppearance?: Appearance;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const [themeId, setThemeId] = useState<string>(initialThemeId ?? DEFAULT_THEME_ID);
  const [appearance, setAppearance] = useState<Appearance>(
    initialAppearance ?? DEFAULT_APPEARANCE,
  );
  // One stable object per (theme, mode, appearance): consumers re-render only
  // when the selection actually changes, not when the provider re-renders for
  // any other reason. An unknown id resolves to the default inside
  // `getThemeBundle`, so this can never return undefined.
  const theme = useMemo(
    () => getThemeBundle(themeId, mode, appearance),
    [themeId, mode, appearance],
  );

  const value = useMemo(
    () => ({
      theme,
      themeId,
      appearance,
      setThemeMode: (next: ThemeMode) => setMode(next),
      setThemeId,
      setAppearance,
    }),
    [theme, themeId, appearance],
  );
  return <KonduktThemeContext.Provider value={value}>{children}</KonduktThemeContext.Provider>;
}

/** The current theme bundle, the selections behind it, and the root setters. */
export function useKonduktTheme(): {
  theme: KonduktTheme;
  themeId: string;
  appearance: Appearance;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeId: (id: string) => void;
  setAppearance: (appearance: Appearance) => void;
} {
  const context = useContext(KonduktThemeContext);
  if (!context) {
    throw new Error('useKonduktTheme must be used inside KonduktThemeProvider');
  }
  return context;
}
