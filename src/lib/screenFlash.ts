/**
 * The one-shot handoff message between an editor and the registry it returns
 * to.
 *
 * The prototype keeps this in `localStorage` (`kondukt.barangays.flash`) and
 * consumes it with `takeFlash()` so a reload never repeats a message about a
 * write that already happened. The app's router has no flash channel and the
 * editors' props are fixed at `{ id, onBack }`, so the message lives here
 * instead: set on a successful write, consumed by the screen that shows it,
 * exactly once. Module state, never persisted — a reload starts with nothing
 * to repeat, which is the prototype's rule without the prototype's key.
 */

let pending: string | null = null;

/** The editor announces a completed write just before navigating back. */
export function setScreenFlash(message: string): void {
  pending = message;
}

/**
 * The registry reads the message on mount. One consumer, one read: the second
 * call returns null, so the sentence is never shown twice.
 */
export function takeScreenFlash(): string | null {
  const message = pending;
  pending = null;
  return message;
}
