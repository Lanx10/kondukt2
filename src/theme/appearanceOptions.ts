import type { IconName } from '../icons';
import type { AppearanceChoiceAxis } from './appearance';
import type { Appearance } from './types';

/**
 * What each Advanced Appearance value is CALLED, and what it does.
 *
 * The catalogue lives beside `appearance.ts` rather than inside the settings
 * screen because it is the same subject: `appearance.ts` decides what a value
 * renders, and this says what a driver is choosing when they pick it. Change
 * what `strong` means in one file, and the engine and its description cannot
 * drift apart - which is the whole reason the values were moved out of a
 * 1,000-line screen and next to the code that implements them.
 *
 * The VALUES still come from the engine. Every `value` below is a member of its
 * axis's own union, so a value the transform cannot render is a build failure
 * here rather than a row that does nothing.
 *
 * The `IconName` import is type-only and is erased at compile time: the glyph
 * beside a value is a name, never a component, so this module stays free of
 * React and of any runtime import at all.
 */

/** One of the five enumerated axes' values, with the copy that names it. */
export type AppearanceChoiceOption = {
  value: Appearance[AppearanceChoiceAxis];
  label: string;
  /** The consequence, which is the thing being chosen between. */
  sub: string;
  icon: IconName;
};

/** One axis: its caption, and the values it accepts. */
export type AppearanceChoiceGroup = {
  axis: AppearanceChoiceAxis;
  label: string;
  options: AppearanceChoiceOption[];
};

/**
 * The five enumerated axes, in the order they read: the field itself, how hard
 * it reads, which way it runs, what the panels over it are made of, and how
 * hard the ink on it is.
 */
export const APPEARANCE_CHOICE_GROUPS: AppearanceChoiceGroup[] = [
  {
    axis: 'background',
    label: 'BACKGROUND',
    options: [
      {
        value: 'gradient',
        label: 'Gradient',
        sub: 'The shipped wash: a warm corner, the page, a cool corner.',
        icon: 'lightMode',
      },
      {
        value: 'soft',
        label: 'Soft gradient',
        sub: 'One field only, so the page is not two coloured blobs.',
        icon: 'filterList',
      },
      {
        value: 'solid',
        label: 'Solid',
        sub: 'A flat page colour, with no field at all.',
        icon: 'grid',
      },
    ],
  },
  {
    axis: 'gradientIntensity',
    label: 'GRADIENT INTENSITY',
    options: [
      {
        value: 'subtle',
        label: 'Subtle',
        sub: 'The corners pull in toward the page colour.',
        icon: 'filterList',
      },
      {
        value: 'balanced',
        label: 'Balanced',
        sub: 'The field this app has always drawn, at full strength.',
        icon: 'advanced',
      },
      {
        value: 'strong',
        label: 'Strong',
        sub: 'The corners push further out of the page colour.',
        icon: 'zap',
      },
    ],
  },
  {
    axis: 'gradientDirection',
    label: 'GRADIENT DIRECTION',
    options: [
      {
        value: 'tlBr',
        label: 'Top-left to bottom-right',
        sub: 'The shipped 135 degree field.',
        icon: 'route',
      },
      {
        value: 'topBottom',
        label: 'Top to bottom',
        sub: 'Warm at the top of the page, cool at the foot.',
        icon: 'chevronDown',
      },
      {
        value: 'leftRight',
        label: 'Left to right',
        sub: 'Warm down the left edge, cool down the right.',
        icon: 'arrowRight',
      },
      {
        value: 'blTr',
        label: 'Bottom-left to top-right',
        sub: 'Warm below, cool above.',
        icon: 'swap',
      },
    ],
  },
  {
    axis: 'surfaceStyle',
    label: 'SURFACE STYLE',
    options: [
      {
        value: 'standard',
        label: 'Standard',
        sub: 'The shipped depth: a wash, a lit edge, a short lift.',
        icon: 'check',
      },
      {
        value: 'soft',
        label: 'Soft',
        sub: 'Half the wash and no lift at all. Flatter and calmer.',
        icon: 'filterList',
      },
      {
        value: 'elevated',
        label: 'Elevated',
        sub: 'A deeper lift and a heavier frost over the field.',
        icon: 'zap',
      },
    ],
  },
  {
    axis: 'contrast',
    label: 'CONTRAST',
    options: [
      {
        value: 'standard',
        label: 'Standard',
        sub: 'The shipped contrast; body text already clears 7:1.',
        icon: 'check',
      },
      {
        value: 'high',
        label: 'High',
        sub: 'Text, outlines and hairlines re-step for glare.',
        icon: 'advanced',
      },
    ],
  },
];

/** The two axes that are on or off rather than one of several. */
export type AppearanceToggle = {
  axis: 'dynamicAccent' | 'reduceEffects';
  label: string;
  sub: string;
  icon: IconName;
};

export const APPEARANCE_TOGGLES: AppearanceToggle[] = [
  {
    axis: 'dynamicAccent',
    label: 'Dynamic accent',
    sub: 'Buttons and marks take the hue of the field, not of the theme.',
    icon: 'lightMode',
  },
  {
    axis: 'reduceEffects',
    label: 'Reduce visual effects',
    sub: 'Blur, grain and the card lift switch off. The layout is unchanged.',
    icon: 'darkMode',
  },
];