import { isUpdateBlocked, setUpdateBlocked } from './updateGuard';

/**
 * Self-check for the workflow guard — the registry that keeps an OTA prompt
 * or restart away from an in-progress transaction (a half-entered ticket, a
 * trip ending under the operator's finger).
 *
 * Run with: npx tsx src/lib/updateGuard.test.ts
 *
 * The contract: blocked while ANY key is registered, clear only when the last
 * one leaves, and removing an unknown key changes nothing. The screens'
 * `useUpdateGuard` hook is a thin effect over these two functions, so the
 * registry is where the semantics live.
 */

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'pass' : 'FAIL'}  ${name}${
      ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`
    }`,
  );
}

check('clear when nothing is registered', isUpdateBlocked(), false);

setUpdateBlocked('add-ticket', true);
check('a registered key blocks', isUpdateBlocked(), true);

setUpdateBlocked('current-trip', true);
setUpdateBlocked('add-ticket', false);
check('a second key keeps the block after the first leaves', isUpdateBlocked(), true);

setUpdateBlocked('current-trip', false);
check('clears when the last key leaves', isUpdateBlocked(), false);

setUpdateBlocked('unknown-key', false);
check('clearing an unknown key is a no-op', isUpdateBlocked(), false);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
