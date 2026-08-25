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
    // The base rule cannot tell a type import from a value one; the
    // typescript-eslint version can, and `allowTypeImports` is the difference
    // that matters here. `import type { UserKind }` erases at compile time and
    // cannot build a query — the thing this rule exists to prevent. Restricting
    // it would only push files into the exemption list below for no safety, and
    // a list that means two different things stops meaning either.
    "no-restricted-imports": "off",
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            // An anchored regex, not a `group` of globs, and that is the whole
            // point. Glob groups are matched with GITIGNORE semantics, under
            // which `@/lib/db` excludes the whole DIRECTORY — so the previous
            // form also blocked `@/lib/db/scope` and `@/lib/db/schema`, the two
            // modules a caller is supposed to reach for. This rule forbade the
            // very import its own message recommends.
            //
            // Nothing had hit it: the auth files import table values but are
            // exempt above for the unrelated `users` reason, and every other
            // file so far imports only types, which `allowTypeImports` waves
            // through. FUEL-15's seed loader is the first file in src/ to write
            // a scoped query, and it cannot: `scope()` takes table objects as
            // arguments, so blocking `schema` blocks scoped writes and nothing
            // else. Nor can the negation be expressed as a glob — gitignore
            // cannot re-include a file whose parent directory is excluded.
            //
            // DEFAULT DENY: anything naming the `db` directory is restricted,
            // and the safe siblings are the named exceptions.
            //
            // Enumerating the forbidden spellings instead was tried twice and
            // failed twice. `(^|/)db(/pool)?$` let `@/lib/db/index` and
            // `@/lib/db/` through; adding those still let `@/lib/db/index.js`,
            // `@/lib/db/./index` and `@/lib/db//index` through — all of which
            // TypeScript resolves to the raw handle, verified. ESLint matches
            // the specifier STRING and performs no module resolution, so a
            // pattern listing bad spellings loses to whoever writes a new one.
            // Listing the good ones cannot: a specifier not ending in `scope`
            // or `schema` is refused however it is spelled.
            //
            // It also fails closed in the right direction. A module added to
            // src/lib/db/ later is restricted the day it appears, rather than
            // being reachable until someone remembers to extend a denylist.
            //
            // No exception can bypass the scope. `scope.ts` IS the choke point
            // and holds no connection: it takes its executor as an argument.
            // `schema.ts` is table definitions, and a table object with no
            // executor cannot run a statement — while `scope()` takes those
            // objects as arguments, so restricting them would restrict scoped
            // writes and nothing else.
            //
            // `db/queries/*` is the third, and it is a CATEGORY rather than a
            // filename (FUEL-18). Something has to bind a scope to a handle for
            // a request — `scope(session.userId, getDb())` — and only this
            // directory may hold the `getDb()` half. A query module is what
            // comes out of that: it runs scoped statements and returns ROWS,
            // never a handle, never a builder, never a `Scope`. That is the
            // same line scope.ts draws one level up, and it is what makes one
            // safe to import from `app/`.
            //
            // A directory rather than a growing list of names, because P2's
            // week loader and P4's totals are the same shape — and a rule
            // edited once per feature is a rule nobody reads. Exactly one
            // segment is allowed after `queries/`, so `db/queries/../index`
            // normalises back onto the handle and stays refused.
            //
            // tests/unit/scope-import-rule.test.ts runs this config over every
            // spelling above, in both directions.
            regex:
              "^(?!.*/(scope|schema)(\\.[tj]s)?$)(?!.*/db/queries/[^/]+$).*(^|/)db(/.*)?$",
            allowTypeImports: true,
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

// `const { key, ingredients, ...row } = seed` is how a seed entry is narrowed to
// the columns its table actually has (see src/lib/seed/load.ts). The two named
// keys exist only to be excluded, so flagging them as unused reports the idiom
// working. ESLint's own option for this is off by default; everything else the
// rule catches stays caught.
//
// `argsIgnorePattern` is the same idea one signature along, and it is
// `useActionState` that forces it. That hook calls an action as
// `(previousState, formData)`, so an action ignoring BOTH — `startDemo` in
// src/app/actions/demo.ts takes nothing from the form, because provisioning a
// demo has no fields — must still declare them to be callable. The underscore
// prefix is already the convention here (`_previous` in src/app/login/actions.ts,
// which the default `args: "after-used"` happens not to flag only because the
// argument AFTER it is used). Naming the convention makes the two consistent
// rather than leaving one of them warning.
//
// Narrow on purpose: only a parameter deliberately marked as ignored is
// exempt. An ordinary unused argument is still reported.
const unusedVars = {
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { ignoreRestSiblings: true, argsIgnorePattern: "^_" },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  noRawDatabaseHandles,
  unusedVars,
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
