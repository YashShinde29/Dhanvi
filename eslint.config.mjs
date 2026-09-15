import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// One lint configuration for both apps and every shared package.
export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  { settings: { next: { rootDir: ["apps/user-web/", "apps/admin-web/"] } } },
  globalIgnores(["**/.next/**", "**/out/**", "**/build/**", "**/node_modules/**", "**/next-env.d.ts", "backend/**", "tools/**", "docs/**"]),
]);
