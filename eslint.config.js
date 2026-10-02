// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const konduktRules = require("./eslint-rules/no-module-scope-stylesheet");

module.exports = defineConfig([
  expoConfig,
  {
    // `.kilo/**` holds a detached worktree of an older checkout: stale copies
    // of every screen, not part of this branch. Linting them reported real
    // module-scope stylesheets that this tree no longer has.
    ignores: ["dist/*", ".kilo/**", ".remember/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { kondukt: konduktRules },
    rules: {
      // A stylesheet built at module scope is frozen to the palette that
      // loaded first, which is how light screens survived into dark sessions.
      "kondukt/no-module-scope-stylesheet": "error",
    },
  },
]);