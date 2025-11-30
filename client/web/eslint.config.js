import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    "react-hooks": reactHooks,
    "react-refresh": reactRefresh,
    "security": security,
    "@typescript-eslint": tseslint.plugin,
  },
  rules: {
  ...reactHooks.configs.recommended.rules,
  ...security.configs.recommended.rules,
  "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
  "@typescript-eslint/no-unused-vars": "off",
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-unsafe-return": "off",

  // SECURITY: Disable overly aggressive object injection detection
  // This rule has too many false positives with TypeScript
  // Real object injection risks are caught by Semgrep
  "security/detect-object-injection": "off",

  // Keep important security rules enabled
  "security/detect-unsafe-regex": "error",
  "security/detect-buffer-noassert": "error",
  "security/detect-child-process": "warn",
  "security/detect-disable-mustache-escape": "error",
  "security/detect-eval-with-expression": "error",
  "security/detect-no-csrf-before-method-override": "error",
  "security/detect-non-literal-fs-filename": "warn",
  "security/detect-non-literal-regexp": "warn",
  "security/detect-non-literal-require": "warn",
  "security/detect-possible-timing-attacks": "warn",
  "security/detect-pseudoRandomBytes": "error",
},
  },
);
