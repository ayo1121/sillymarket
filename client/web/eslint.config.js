import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

// Hack: Create a patched plugin that includes missing rules referenced in legacy code
const dummyRule = { create: () => ({}) };
const patchedPlugin = {
  ...tseslint.plugin,
  rules: {
    ...tseslint.plugin.rules,
    "no-unsafe-assignment": dummyRule,
    "ban-types": dummyRule,
    "no-unsafe-return": dummyRule,
  },
};

// Patch the recommended configs to use our patched plugin
const patchedRecommendedConfigs = tseslint.configs.recommended.map((cfg) => {
  if (cfg.plugins && cfg.plugins["@typescript-eslint"]) {
    return {
      ...cfg,
      plugins: {
        ...cfg.plugins,
        "@typescript-eslint": patchedPlugin,
      },
    };
  }
  return cfg;
});

export default tseslint.config(
  { ignores: ["dist"] },
  {
    // Global settings for all files
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  js.configs.recommended,
  ...patchedRecommendedConfigs,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "security": security,
    },
    rules: {
      "no-undef": "off", // TypeScript checks this
      ...reactHooks.configs.recommended.rules,
      ...security.configs.recommended.rules,
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",

      // SECURITY: Disable overly aggressive object injection detection
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
