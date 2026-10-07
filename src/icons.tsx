/**
 * One icon family for every glyph on this screen.
 *
 * MaterialCommunityIcons ships inside the Expo bundle, so the font resolves with
 * no network request and every glyph carries an identical stroke weight by
 * construction. Drawing the shapes in code could promise neither offline nor
 * consistency — hand-tuned outlines drift apart the moment one is tweaked.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useKonduktTheme } from './lib/themeContext';

/** Screen-level names mapped to their MaterialCommunityIcons glyph. */
const GLYPHS = {
  bus: 'bus',
  ticket: 'ticket-outline',
  person: 'account-outline',
  history: 'history',
  settings: 'cog-outline',
  play: 'play',
  grid: 'view-grid-outline',
  database: 'database-outline',
  chevron: 'chevron-right',
  chevronLeft: 'chevron-left',
  chevronDown: 'chevron-down',
  calendar: 'calendar-blank-outline',
  close: 'close',
  search: 'magnify',
  check: 'check',
  arrowRight: 'arrow-right',
  // The Passengers card's Switch-trip control, per passenger.html.
  swap: 'swap-horizontal',
  route: 'map-marker-path',
  // The location pin. Barangay Configuration's municipality scope field is the
  // one control that asks for a place rather than naming a category.
  pin: 'map-marker-outline',
  wallet: 'wallet-outline',
  // Settings module glyphs. Same family, same stroke weight by construction.
  fare: 'cash-multiple',
  terminal: 'map-marker-radius',
  barangay: 'map',
  municipality: 'domain',
  trash: 'trash-can-outline',
  advanced: 'tune',
  lock: 'lock-outline',
  lightMode: 'weather-sunny',
  darkMode: 'weather-night',
  contentSave: 'content-save-outline',
  filterList: 'filter-variant',
  plus: 'plus',
  pencil: 'pencil-outline',
  // Advanced Settings' fact glyphs: the bolt is the immediate commit, the
  // clock is the launch read, the alert is the refused write.
  zap: 'lightning-bolt-outline',
  clock: 'clock-outline',
  alert: 'alert-outline',
  // Settings' update card: the same family's circular arrow.
  update: 'update',
} as const;

export type IconName = keyof typeof GLYPHS;

export function Icon({
  name,
  size = 24,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const { theme } = useKonduktTheme();
  return (
    <MaterialCommunityIcons
      name={GLYPHS[name]}
      size={size}
      color={color ?? theme.palette.onSurface}
      // Every glyph here sits beside a text label that already carries the
      // accessible name, so the icon itself is decorative.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
