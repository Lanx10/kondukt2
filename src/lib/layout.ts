/**
 * Width breakpoints shared by every grid.
 *
 * These are M3 window size classes, not measurements copied off a reference
 * image: a layout has to behave the same at widths nobody screenshotted. Cards
 * stop being readable well before the window does, which is why the narrow
 * threshold sits at 340 rather than at some device width.
 */

/** Below this a card cannot hold an icon and a readable label side by side. */
export const NARROW_WIDTH = 340;

/** Below this there is not enough room for three comfortable columns. */
export const MEDIUM_WIDTH = 640;

/**
 * Below this a two-line row can no longer hold its leading block (time, or
 * date) beside its body without wrapping the route. Wider than NARROW_WIDTH
 * because a row is free to stack gracefully — it just reads worse.
 */
export const ROW_STACK_WIDTH = 400;

/**
 * Below this a summary stat tile is too narrow to hold a peso amount on one
 * line, so the grid drops to a single column.
 */
export const STAT_STACK_WIDTH = 300;
