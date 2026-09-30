/**
 * The workflow guard: screens that own an in-progress transaction register
 * here, and the update system consults the registry before it pops the
 * "Update available" sheet or restarts the app.
 *
 * Kondukt's rule: recording a ticket, choosing a trip route, or starting a
 * trip must never be interrupted by an update prompt or an unexpected
 * reload. An update that arrives while such a screen is mounted stays
 * *available* — the Settings card says so — and waits for an explicit
 * "Update Now" (which can only be pressed from Settings, where no
 * transaction screen is mounted) or for the next cold start.
 *
 * Registration is reference-counted by key: two guarded screens can be
 * mounted at once, and the guard clears only when every one has unmounted.
 */
import { useEffect } from 'react';

const blockedKeys = new Set<string>();

/** Marks a workflow as blocked (true) or clear (false) under `key`. */
export function setUpdateBlocked(key: string, blocked: boolean): void {
  if (blocked) blockedKeys.add(key);
  else blockedKeys.delete(key);
}

/** True while any transaction screen is mounted. */
export function isUpdateBlocked(): boolean {
  return blockedKeys.size > 0;
}

/**
 * Registers `key` for as long as `active` is true — mount it inside the
 * screens that own transactions and forget about it.
 */
export function useUpdateGuard(key: string, active = true): void {
  useEffect(() => {
    if (!active) return;
    setUpdateBlocked(key, true);
    return () => setUpdateBlocked(key, false);
  }, [key, active]);
}
