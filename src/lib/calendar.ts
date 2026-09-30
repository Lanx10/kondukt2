/**
 * Calendar labels, split out from `format.ts` so a component that needs month
 * names does not have to reach into a module whose public surface is the
 * sentence-case display strings.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Month names for a calendar header, unabbreviated. */
export const MONTH_NAMES = MONTHS;

/** Single-letter weekday headers, Sunday-first to match `Date.getDay()`. */
export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
