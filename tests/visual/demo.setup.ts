import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { expect, test as setup } from "@playwright/test";

import { testDatabaseUrl } from "../integration/env";
import { allTables, truncateAll } from "../integration/tables";
import { STORAGE_STATE } from "./constants";

/**
 * Provisions the one demo account every baseline is drawn from.
 *
 * A setup *project* rather than `globalSetup`, because this has to talk to the
 * running application: Playwright brings `webServer` up around the tests, so a
 * global setup hook has no server to POST to, while a setup project runs as an
 * ordinary test once the server is answering.
 *
 * Runs once per run. Fifty-six screenshots then share the session, which turns
 * ~70s of provisioning into ~1.2s of it.
 */

const databaseUrl = testDatabaseUrl();

if (!databaseUrl) {
  // playwright.config.ts has already thrown by this point; repeated so this file
  // is safe to read on its own and cannot be made to run against DATABASE_URL by
  // some later refactor of the config.
  throw new Error("DATABASE_URL_TEST is not set — refusing to seed a demo.");
}

const db = drizzle({ client: neon(databaseUrl) });

/**
 * The cookie the demo session travels in — `COOKIE.demo` in
 * `src/lib/auth/cookies.ts`. Named literally rather than imported because that
 * module pulls in `@/lib/db/schema` for a type, and this file has no need of the
 * schema at all.
 */
const DEMO_COOKIE = "ff_demo";

setup("provision the demo session", async ({ page, context }) => {
  /**
   * ## Why the branch is emptied first
   *
   * `DEMO_LIMITS` allows three provisions per client per ten minutes
   * (`src/lib/demo.ts`). Behind `next start` nothing sets `x-forwarded-for`, so
   * every run falls into the single `UNIDENTIFIED` bucket and shares one
   * allowance — and because the clock is frozen, rows written by *previous* runs
   * carry the same `created_at` as this one and never age out of the window.
   * Left alone, the fourth run of the day would be refused, and every run after
   * it, permanently.
   *
   * Truncating is therefore not tidiness; it is what makes the suite repeatable.
   * It is also why the guard above is absolute: this statement empties every
   * table it can see.
   */
  await migrate(db, { migrationsFolder: "drizzle" });
  await truncateAll(db);

  await page.goto("/login");

  /**
   * The session is taken from the `Set-Cookie` header, not from the cookie jar.
   *
   * The server stamps the cookie's expiry from its own clock, which this suite
   * has frozen to June 2026 — an instant that is, to the browser's real clock,
   * already past. Chromium duly discards it. Nothing here is broken: the cookie
   * is correct and so is the refusal, and this is the one place where freezing
   * the server's clock and not the browser's is visible. It is re-added below on
   * the browser's own terms.
   *
   * The waiter is armed BEFORE the click. "Try the demo" posts a Server Action
   * back to `/login` and the cookie rides on that response; waiting on the
   * button's pending label instead would be a race that usually wins and is
   * always wrong, because "Opening the demo…" is absent before React re-renders
   * as well as after — so the assertion can be satisfied by the state the page
   * was already in, and let the run continue before any response exists.
   */
  const provisioning = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/login",
  );

  await page.getByRole("button", { name: "Try the demo" }).click();

  const headers = await (await provisioning).headersArray();

  const token = headers
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .flatMap((header) => {
      const match = /^\s*ff_demo=([^;]+)/.exec(header.value);
      return match ? [match[1]] : [];
    })
    .at(-1);

  expect(
    token,
    "The demo POST set no ff_demo cookie. Either provisioning was refused — the " +
      "rate limit, or capacity — or the login form changed shape.",
  ).toBeTruthy();

  /**
   * ## The positive control
   *
   * Next's `@next/env` does not overwrite variables already present in the
   * environment, so the `DATABASE_URL` the config hands `webServer` should win
   * over the one in `.env.local`. "Should" is doing too much work in a sentence
   * about writing two hundred rows into the wrong database, so it is checked:
   * the branch was emptied a moment ago, and the demo user can only be here if
   * the server wrote it here.
   *
   * A silent fallback to `DATABASE_URL` would leave this count at zero and fail
   * loudly, rather than leaving demo rows in production and a green run.
   */
  const users = allTables.find(([name]) => name === "users")?.[1];

  expect(users, "No `users` table in the schema walk.").toBeTruthy();

  const provisioned = await db.select().from(users!);

  expect(
    provisioned,
    "The demo was provisioned somewhere other than DATABASE_URL_TEST — the test " +
      "branch is still empty. Check that nothing has begun overriding " +
      "DATABASE_URL after the environment is set.",
  ).toHaveLength(1);

  /**
   * Re-added as a session cookie (`expires: -1`), which has no expiry to compare
   * against a clock and lives exactly as long as the browser context. `secure`
   * is dropped because the suite speaks http to localhost; the flag governs when
   * a browser will *send* a cookie and is not read back by the server, so
   * clearing it changes nothing the application can observe.
   */
  await context.addCookies([
    {
      name: DEMO_COOKIE,
      value: token!,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires: -1,
    },
  ]);

  /**
   * Proof the session actually works before fifty-six screenshots are taken
   * through it. Without this, a broken session would be photographed as
   * fifty-six pictures of the login screen — all of them stable, all of them
   * committed, and every one of them a passing baseline of the wrong page.
   */
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/Demo session/i)).toBeVisible();

  await context.storageState({ path: STORAGE_STATE });
});
