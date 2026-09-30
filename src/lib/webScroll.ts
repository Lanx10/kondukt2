import { Platform } from 'react-native';

/**
 * Web-only scroll guards.
 *
 * The reference is a phone frame with the field pinned inside it: the page
 * itself never scrolls, only the app's own container does, so nothing
 * rubber-bands past the content and the gradient never slides with it. Expo web
 * generates its `index.html` at build time (the project has no template of its
 * own), so the equivalent CSS is applied once at app entry instead.
 *
 * Two deliberate choices:
 *
 * - `overflow: hidden` on the document, not just the scroll container. Left
 *   alone, the RN web root grows with its content and the *page* becomes the
 *   outer scroller, which is what produced two nested scrollers of the same
 *   height and the bounce at the end of every screen.
 * - `overscroll-behavior: none` on every element, so a nested list that reaches
 *   its end cannot hand the gesture to the page behind it.
 *
 * No-op on native, where the same job is `bounces={false}` / `overScrollMode`.
 */
export function installWebScrollGuards() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  const { documentElement: html, body, head } = document;
  html.style.height = '100%';
  html.style.overflow = 'hidden';
  html.style.overscrollBehavior = 'none';
  body.style.height = '100%';
  body.style.margin = '0';
  body.style.overflow = 'hidden';
  body.style.overscrollBehavior = 'none';

  const ID = 'kondukt-scroll-guard';
  if (document.getElementById(ID)) return;

  const style = document.createElement('style');
  style.id = ID;
  style.textContent = [
    // The app root fills the frame; the screens own the scrolling from here.
    'html, body, #root { height: 100%; overscroll-behavior: none; }',
    // Every RN-web scroll container clamps at its own edges rather than
    // chaining the gesture to whatever sits behind it.
    '* { overscroll-behavior: none; }',
  ].join('\n');
  head.appendChild(style);
}
