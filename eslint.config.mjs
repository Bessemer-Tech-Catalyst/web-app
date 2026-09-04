import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git worktrees are second checkouts of this repo, carrying their own node_modules
    // and run artifacts. Linting them buries the real findings under ~38k duplicates.
    ".claude/**",
    // Run workspaces: generated suites and Playwright output, not source.
    ".odyssey/**",
  ]),
]);

export default eslintConfig;
