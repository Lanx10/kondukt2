import { useMemo } from 'react';
import type { KonduktTheme } from '../theme';
import { useKonduktTheme } from './themeContext';

/**
 * Builds a stylesheet from the current theme, and keeps it stable.
 *
 * Every themed component in this app is the same three lines: take the theme
 * from context, run a module-scope factory over it, memoise the result. That
 * shape exists because `StyleSheet.create` must not be called at module scope
 * with a theme in scope — a stylesheet built once at import time is frozen to
 * the palette that happened to be loaded first, which is how half the app used
 * to render a light screen inside a dark session.
 *
 * The factory stays a module-scope function rather than an inline arrow so its
 * identity never changes and the memo actually holds. Declare it as
 * `const makeStyles = (theme: KonduktTheme) => StyleSheet.create({ ... })`.
 *
 * Components that also pass a token straight to a prop — an `Icon` colour, an
 * inline background — still need `theme` itself, so `useKonduktTheme` is
 * independent of this hook and calling both is normal.
 */
export function useThemedStyles<T>(makeStyles: (theme: KonduktTheme) => T): T {
  const { theme } = useKonduktTheme();
  return useMemo(() => makeStyles(theme), [makeStyles, theme]);
}