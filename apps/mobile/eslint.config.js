const js = require("@eslint/js");
const ts = require("typescript-eslint");
module.exports = ts.config(
  {
    ignores: [
      "dist/**",
      ".expo/**",
      "node_modules/**",
      "android/**",
      "ios/**",
      "eslint.config.js",
      "app.config.js",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);
