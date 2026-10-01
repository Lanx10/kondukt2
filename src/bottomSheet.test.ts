/**
 * Self-check for the bottom-sheet layout contract.
 *
 * Run with: npx tsx src/bottomSheet.test.ts
 *
 * Why it is a source scan and not a render test: the bug it guards against is
 * an Android-only Yoga collapse that react-native-web stretches away, so a
 * browser render proves nothing. `flex: 1` is `flexBasis: 0`, and inside a
 * sheet whose height is its content a basis of 0 has no definite height to
 * grow into — the body renders zero height and the rows vanish (title only).
 * The rules the app relies on:
 *
 *   1. No sheet-body style may set `flex: 1`.
 *   2. The fill body must keep `flexBasis: 'auto'` so a short list hugs its
 *      content and a long one is bounded by the sheet's `maxHeight`.
 *   3. A non-fill `Sheet` already wraps its children in a ScrollView, so a
 *      screen must never hand it another one — nested vertical ScrollViews do
 *      not scroll on Android, the inner one is dead weight. A `fill` sheet's
 *      ScrollView is the body's only scroll and is allowed.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const src = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * The index just past the opening tag that starts at `from`, counting `>` only
 * at brace/paren depth zero so a `footer={<View>}` prop's own `>` does not end
 * the tag early.
 */
function endOfOpeningTag(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (c === '{' || c === '(') depth += 1;
    else if (c === '}' || c === ')') depth -= 1;
    else if (c === '>' && depth === 0) return i + 1;
  }
  return -1;
}

const files = walk(src);
assert.ok(files.length > 0, 'no .tsx files found under src/');

const sheetSource = readFileSync(join(src, 'components', 'BottomSheet.tsx'), 'utf8');

// 1 + 2: the shared sheet's own styles.
const sheetStyles = new Map<string, string>();
for (const m of sheetSource.matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
  sheetStyles.set(m[1] as string, m[2] as string);
}
for (const name of ['sheet', 'sheetBody', 'sheetBodyFill', 'sheetScroll']) {
  const body = sheetStyles.get(name);
  assert.ok(body !== undefined, `BottomSheet.tsx is missing the \`${name}\` style`);
  assert.ok(
    !/\bflex\s*:\s*1\b/.test(body),
    `BottomSheet \`${name}\` sets flex: 1 (flexBasis: 0) — Android collapses it to zero height`,
  );
}
const fillBody = sheetStyles.get('sheetBodyFill') as string;
assert.match(
  fillBody,
  /flexBasis\s*:\s*'auto'/,
  'sheetBodyFill lost flexBasis: auto; a fill body needs its content height to grow from',
);
assert.match(
  fillBody,
  /flexShrink\s*:\s*1/,
  'sheetBodyFill must shrink for the sheet maxHeight clamp to bind',
);

// 3: no screen hands a ScrollView to a non-fill Sheet. Both syntaxes count —
// the hand-written JSX child form, and the transpiled `children:` prop form
// that AddTicketScreen.tsx and HomeScreen.tsx are committed in.
const PROP_SHEET =
  /_componentsBottomSheet\.Sheet,\s*\{/g;
const PROP_SCROLL_CHILDREN =
  /children:\s*(?:\/\*#__PURE__\*\/\s*)?\(0,\s*_reactJsxRuntime\.jsx[s]?\)\(_reactNative\.ScrollView/g;

for (const file of files) {
  const source = readFileSync(file, 'utf8');

  for (let i = source.indexOf('<Sheet'); i !== -1; i = source.indexOf('<Sheet', i + 1)) {
    const tagEnd = endOfOpeningTag(source, i);
    assert.notEqual(tagEnd, -1, `${file}: unterminated <Sheet at offset ${i}`);
    const tag = source.slice(i, tagEnd);
    const firstChild = /^\s*\n?\s*<ScrollView\b/.test(source.slice(tagEnd));
    assert.ok(
      !(firstChild && !/\bfill\b/.test(tag)),
      `${file}: a non-fill Sheet's first child is a ScrollView, but Sheet already wraps ` +
        `non-fill children in one. Nested vertical ScrollViews do not scroll on Android.`,
    );
  }

  for (const m of source.matchAll(PROP_SCROLL_CHILDREN)) {
    // The owning Sheet call is the nearest one before this `children:` prop.
    const head = source.slice(0, m.index);
    const lastOpen = [...head.matchAll(PROP_SHEET)].pop();
    assert.notEqual(lastOpen, undefined, `${file}: a Sheet children ScrollView with no Sheet`);
    const isFill = /\bfill:\s*true\b/.test(head.slice(lastOpen?.index ?? 0));
    assert.ok(
      isFill,
      `${file}: a Sheet's children are a ScrollView, but a non-fill Sheet already wraps ` +
        `children in one. Nested vertical ScrollViews do not scroll on Android.`,
    );
  }
}

console.log(`ok — ${files.length} .tsx files, sheet layout contract holds`);