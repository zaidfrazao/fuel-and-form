import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// FUEL-7 / PRD § Security & Compliance: "Every query is scoped by `user_id` at
// the data-access layer." A raw handle is the one way to write a query that
// isn't, so reaching for one outside src/lib/db is an error rather than a
// convention — the acceptance criterion is "no query path exists that bypasses
// the scope helper", and only a machine can keep saying so on every push.
// FUEL-12: the auth layer is the one legitimate exception, because `users` is
// the one table `scope()` cannot read — it carries no `user_id`, its own `id`
// IS the user, and resolving a cookie to an identity necessarily happens before
// there is an identity to scope by (see the note on the table in schema.ts).
//
// Named file by file rather than as `src/lib/auth/**`, so a future file added
// beside these does not silently inherit the permission. Every query in them is
// against `users` alone; anything user-owned still goes through the scope.
const authenticationReadsUsers = [
  "src/lib/auth/resolve.ts",
  "src/lib/auth/owner.ts",
  "src/lib/auth/session.ts",
];

const noRawDatabaseHandles = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/lib/db/**", ...authenticationReadsUsers],
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
