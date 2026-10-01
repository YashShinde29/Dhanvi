import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      // Money must never be parsed through floating point. Use utils/money.ts.
      "no-restricted-properties": ["error",
        { object: "Math", property: "random", message: "Use crypto.randomBytes / utils/crypto.ts; selection randomness must be auditable." },
        { object: "Number", property: "parseFloat", message: "Use Decimal (utils/money.ts) for monetary values." }],
      "no-restricted-globals": ["error", { name: "parseFloat", message: "Use Decimal (utils/money.ts) for monetary values." }],
    },
  },
);
