import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

export default tseslint.config(
    { ignores: ["dist", "node_modules"] },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ["**/*.ts"],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.node,
        },
        plugins: {
            "security": security,
        },
        rules: {
            ...security.configs.recommended.rules,
            "@typescript-eslint/no-unused-vars": "off",
            "@typescript-eslint/no-explicit-any": "off",

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
