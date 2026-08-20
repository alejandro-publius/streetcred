// One config, no framework, no plugins.
//
// This repo has no package.json and no install step by design, so the lint is
// run on demand with `npx eslint .` and nothing is vendored into the tree. The
// rules are the ones that catch real defects in a Worker: a name that is used
// before it exists, a promise nobody awaits, a case that falls through. Style
// is not linted, because this codebase's style is its comments and no rule
// engine has an opinion worth having about those.
export default [
  { ignores: ["public/**", "assets/**", ".wrangler/**", "data/**", "sweep-*.json"] },
  {
    files: ["src/**/*.js", "synth/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        // The Workers runtime surface this code actually touches.
        fetch: "readonly", Response: "readonly", Request: "readonly", Headers: "readonly",
        URL: "readonly", URLSearchParams: "readonly", caches: "readonly", crypto: "readonly",
        console: "readonly", btoa: "readonly", atob: "readonly", TextEncoder: "readonly",
        TextDecoder: "readonly", AbortController: "readonly", setTimeout: "readonly",
        clearTimeout: "readonly", Intl: "readonly", structuredClone: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["tools/**/*.mjs", "tools/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        process: "readonly", console: "readonly", fetch: "readonly", URL: "readonly",
        URLSearchParams: "readonly", Response: "readonly", Headers: "readonly",
        TextEncoder: "readonly", TextDecoder: "readonly", setTimeout: "readonly",
        clearTimeout: "readonly", structuredClone: "readonly", AbortController: "readonly",
        Buffer: "readonly", crypto: "readonly", Intl: "readonly", btoa: "readonly", atob: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
