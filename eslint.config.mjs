import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// FUEL-7 / PRD § Security & Compliance: "Every query is scoped by `user_id` at
// the data-access layer." A raw handle is the one way to write a query that
// isn't, so reaching for one outside src/lib/db is an error rather than a
// convention — the acceptance criterion is "no query path exists that bypasses
// the scope helper", and only a machine can keep saying so on every push.
const noRawDatabaseHandles = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/lib/db/**"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/lib/db", "@/lib/db/pool", "**/lib/db", "**/lib/db/pool"],
            message:
              "Import scope() from @/lib/db/scope instead. getDb() and getPool() " +
              "hand back an unscoped handle, and a query built on one is not " +
              "filtered by user_id — see src/lib/db/scope.ts.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  noRawDatabaseHandles,
  // Replaces (does not extend) the default ignores of eslint-config-next,
  // so the defaults are repeated here alongside our additions.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ours:
    "node_modules/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
