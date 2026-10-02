/**
 * no-module-scope-stylesheet
 *
 * A stylesheet built at module scope is built once, at import time, against
 * whichever palette happened to be loaded first — and never rebuilt. That is
 * the bug that left half this app rendering light screens inside a dark
 * session: `StyleSheet.create({ color: palette.onSurface })` evaluated once
 * with the light `palette`, then frozen for the life of the process, no matter
 * how many times the theme changed.
 *
 * The fix is `useThemedStyles`, which builds the stylesheet per theme and
 * memoises it. This rule points at that.
 *
 * Scope, deliberately narrow: it fires on a module-scope `StyleSheet.create`
 * whose arguments reference a *colour* token from the theme module. A
 * stylesheet built from `space`, `radius` or `type` is identical in both
 * palettes and stays at module scope; one that reads no token at all is a
 * plain constant and is also left alone. Only a palette, a glass field or an
 * accent role — the things that actually change with the mode — is reported.
 *
 * The factory form is the accepted shape and is *not* reported:
 *
 *   const makeStyles = (theme: KonduktTheme) => StyleSheet.create({ ... });
 *   const styles = useThemedStyles(makeStyles);
 *
 * There, `StyleSheet.create` sits inside the arrow function, so it runs per
 * theme rather than once at import.
 */

/** Import specifiers whose source is a theme module, e.g. '../theme'. */
const THEME_MODULE = /(^|\/)theme(\.tsx?)?$/;

/**
 * Theme exports that carry no colour and therefore the same value in both
 * palettes. A stylesheet built from these at module scope is correct and
 * should not be pushed into a factory: `space(4)` is `16` in dark mode too,
 * and rebuilding it per render buys nothing. Everything else in the theme —
 * the palettes, the glass fields, the accent roles — is mode-dependent.
 */
const MODE_INDEPENDENT = new Set([
  'space',
  'radius',
  'type',
  'maxContentWidth',
  'glassBlur',
  'cardShadow',
  'tintedGlass',
  'onPrimarySolid',
]);

/** `StyleSheet.create`, `RN.StyleSheet.create`, `StyleSheet["create"]`. */
function isStyleSheetCreate(node) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type !== 'MemberExpression') return false;
  const property = callee.property;
  const isCreate =
    (property.type === 'Identifier' && property.name === 'create') ||
    (callee.computed && property.type === 'Literal' && property.value === 'create');
  if (!isCreate) return false;

  const object = callee.object;
  // `StyleSheet.create(...)`
  if (!callee.computed && object.type === 'Identifier') return object.name === 'StyleSheet';
  // `ReactNative.StyleSheet.create(...)`
  if (object.type === 'MemberExpression' && !object.computed) {
    return object.property.type === 'Identifier' && object.property.name === 'StyleSheet';
  }
  return false;
}

/**
 * True when the call is evaluated once when the module loads, rather than
 * inside some function that a render will call again.
 */
function isModuleScope(ancestors) {
  const functionTypes = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ObjectExpression',
    'ClassBody',
  ]);
  // `getAncestors` runs Program → immediate parent, so the whole chain is
  // checked: the factory arrow that wraps the call is in there, and its
  // presence is exactly what makes the stylesheet rebuildable.
  return !ancestors.some((ancestor) => functionTypes.has(ancestor.type));
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a module-scope StyleSheet.create that reads a theme token; it is frozen to the palette loaded at import time.',
      recommended: true,
    },
    schema: [],
    messages: {
      frozen:
        'This stylesheet is built once at import and never rebuilt, so it stays frozen to whichever palette loaded first — the reason a dark session could still show light colours. Move it behind a factory and build it per theme: `const makeStyles = (theme: KonduktTheme) => StyleSheet.create({...})`, then `const styles = useThemedStyles(makeStyles)`.',
    },
  },
  create(context) {
    /** Local names bound to theme tokens in this file. */
    const themeNames = new Set();

    return {
      ImportDeclaration(node) {
        if (!node.source || !THEME_MODULE.test(node.source.value)) return;
        for (const specifier of node.specifiers) {
          const local = specifier.local.name;
          if (specifier.type === 'ImportSpecifier') {
            // A renamed import cannot be matched against the export name, so
            // the alias is checked too: `import { palette as p }`.
            if (!MODE_INDEPENDENT.has(local) && !MODE_INDEPENDENT.has(specifier.imported.name)) {
              themeNames.add(local);
            }
          } else if (
            specifier.type === 'ImportNamespaceSpecifier' ||
            specifier.type === 'ImportDefaultSpecifier'
          ) {
            // `import * as theme from '../theme'` — a namespace can reach every
            // export, so any member access on it counts.
            themeNames.add(local);
          }
        }
      },

      CallExpression(node) {
        if (!isStyleSheetCreate(node)) return;
        if (!isModuleScope(context.sourceCode.getAncestors(node))) return;

        // Every identifier the stylesheet object touches, including inside
        // nested spreads and computed values.
        const referenced = new Set();
        const stack = [...node.arguments];
        while (stack.length > 0) {
          const current = stack.pop();
          if (current.type === 'Identifier') referenced.add(current.name);
          else if (current.type === 'MemberExpression' && current.object.type === 'Identifier') {
            referenced.add(current.object.name);
          }
          for (const key of context.sourceCode.visitorKeys[current.type] ?? []) {
            const child = current[key];
            if (Array.isArray(child)) stack.push(...child.filter((n) => n && typeof n.type === 'string'));
            else if (child && typeof child.type === 'string') stack.push(child);
          }
        }

        const offender = [...referenced].find((name) => themeNames.has(name));
        if (offender) context.report({ node, messageId: 'frozen', data: { token: offender } });
      },
    };
  },
};

/** Flat config wants a plugin: a named collection of rules. */
module.exports = {
  rules: { 'no-module-scope-stylesheet': rule },
};