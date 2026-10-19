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
    // Generated build/deploy output and worker typegen:
    ".open-next/**",
    ".wrangler/**",
    "worker-configuration.d.ts",
  ]),
  {
    // Test files intentionally use `any` for mocked Supabase builders and
    // `require()` for isolated module loading.
    files: ["**/*.test.ts", "**/*.test.tsx", "vitest.setup.ts", "vitest.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
