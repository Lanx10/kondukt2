import { Linter } from 'eslint';

/**
 * Self-check for the `kondukt/no-module-scope-stylesheet` lint rule.
 *
 * Run with: npx tsx src/lib/noModuleScopeStylesheet.test.ts
 *
 * The rule guards the bug that left half this app rendering light screens in a
 * dark session: a `StyleSheet.create` at module scope evaluates once, against
 * whichever palette loaded first, and is then frozen for the life of the
 * process. A lint rule that silently stops matching is worse than no rule,
 * because the codebase comes to depend on it — so the shapes it must catch,
 * and the shapes it must deliberately leave alone, are asserted here rather
 * than trusted.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../../eslint-rules/no-module-scope-stylesheet');

const RULE = 'kondukt/no-module-scope-stylesheet';

function report(code: string): string[] {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    code,
    [
      {
        files: ['**/*.tsx'],
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { kondukt: plugin },
        rules: { [RULE]: 'error' },
      },
    ],
    'src/screens/Sample.tsx',
  );
  return messages.filter((m) => m.ruleId === RULE).map((m) => m.message);
}

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

const PRELUDE = `import { StyleSheet } from 'react-native';\n`;

// ── the regression this rule exists for ─────────────────────────────────────
check(
  'a module-scope sheet reading palette.onSurface is reported once',
  report(`${PRELUDE}import { palette } from '../theme';\nconst styles = StyleSheet.create({ a: { color: palette.onSurface } });`).length,
  1,
);
check(
  '…and the message names the fix rather than just the offence',
  report(`${PRELUDE}import { palette } from '../theme';\nconst s = StyleSheet.create({ a: { color: palette.onSurface } });`)[0].includes(
    'useThemedStyles',
  ),
  true,
);

// ── the accepted shape ─────────────────────────────────────────────────────
check(
  'the factory form is not reported',
  report(
    `${PRELUDE}import { palette } from '../theme';\nconst makeStyles = (theme) => StyleSheet.create({ a: { color: palette.onSurface } });`,
  ).length,
  0,
);
check(
  'a module-scope sheet inside a plain function is not reported',
  report(
    `${PRELUDE}import { palette } from '../theme';\nfunction build() { return StyleSheet.create({ a: { color: palette.onSurface } }); }`,
  ).length,
  0,
);
check(
  'a sheet built during render is not reported',
  report(
    `${PRELUDE}import { palette } from '../theme';\nexport function Screen() { const styles = StyleSheet.create({ a: { color: palette.onSurface } }); return styles; }`,
  ).length,
  0,
);

// ── shapes that must be left alone ─────────────────────────────────────────
check(
  'a stylesheet with no theme token is a plain constant, not a bug',
  report(`${PRELUDE}const styles = StyleSheet.create({ a: { flex: 1 } });`).length,
  0,
);
check(
  'geometry tokens are mode-independent, so space() is fine at module scope',
  report(`${PRELUDE}import { space } from '../theme';\nconst styles = StyleSheet.create({ a: { padding: space(4) } });`).length,
  0,
);
check(
  'so is radius',
  report(`${PRELUDE}import { radius } from '../theme';\nconst styles = StyleSheet.create({ a: { borderRadius: radius.large } });`).length,
  0,
);
check(
  'so is type',
  report(`${PRELUDE}import { type } from '../theme';\nconst styles = StyleSheet.create({ a: { ...type.bodySmall } });`).length,
  0,
);
check(
  'a mix of geometry and no colour stays unreported',
  report(
    `${PRELUDE}import { space, radius, type } from '../theme';\nconst styles = StyleSheet.create({ a: { ...type.bodySmall, padding: space(2), borderRadius: radius.small } });`,
  ).length,
  0,
);

// ── detection has to reach past the obvious case ───────────────────────────
check(
  'a token reached through a nested spread is still reported',
  report(
    `${PRELUDE}import { glass } from '../theme';\nimport { type } from '../theme';\nconst styles = StyleSheet.create({ a: { ...type.titleMedium, color: glass.onGlass } });`,
  ).length,
  1,
);
check(
  'a renamed import is not a way round it',
  report(`${PRELUDE}import { palette as p } from '../theme';\nconst styles = StyleSheet.create({ a: { color: p.onSurface } });`).length,
  1,
);
check(
  'a namespace import is not a way round it either',
  report(
    `${PRELUDE}import * as th from '../theme';\nconst styles = StyleSheet.create({ a: { color: th.palette.onSurface } });`,
  ).length,
  1,
);
check(
  'a glass field is a colour, so it is reported',
  report(`${PRELUDE}import { glass } from '../theme';\nconst styles = StyleSheet.create({ a: { backgroundColor: glass.backdrop } });`).length,
  1,
);
check(
  'an accent role is a colour, so it is reported',
  report(`${PRELUDE}import { accent } from '../theme';\nconst styles = StyleSheet.create({ a: { color: accent.primary.fg } });`).length,
  1,
);
check(
  'two offending sheets in one file are both reported',
  report(
    `${PRELUDE}import { palette, glass } from '../theme';\nconst a = StyleSheet.create({ x: { color: palette.onSurface } });\nconst b = StyleSheet.create({ y: { backgroundColor: glass.backdrop } });`,
  ).length,
  2,
);

// ── it must not misread other files' imports ───────────────────────────────
check(
  'a same-named export from another module is not a theme token',
  report(`${PRELUDE}import { palette } from '../data/palette';\nconst styles = StyleSheet.create({ a: { color: palette.onSurface } });`).length,
  0,
);
check(
  'the compiled namespace form is matched too',
  report(
    `import * as RN from 'react-native';\nimport { palette } from '../theme';\nconst styles = RN.StyleSheet.create({ a: { color: palette.onSurface } });`,
  ).length,
  1,
);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);