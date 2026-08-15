import { describe, expect, it } from "vitest";

import { databaseIdentity } from "../integration/env";

/**
 * The guard that stops the integration suite truncating the wrong database.
 *
 * Hermetic — it runs in the default suite, with no connection string and no
 * database, because the thing under test is string comparison. It lives here
 * rather than in `tests/integration/` for exactly that reason: a guard that only
 * ran when a database happened to be configured would be untested on the machine
 * most likely to be misconfigured.
 *
 * The connection strings below are invented. Nothing real is in this file.
 */

const POOLED = "postgresql://u:p@ep-quiet-band-12345678-pooler.eu-west-2.aws.neon.tech/neondb";
const DIRECT = "postgresql://u:p@ep-quiet-band-12345678.eu-west-2.aws.neon.tech/neondb";
const OTHER_BRANCH = "postgresql://u:p@ep-still-sun-87654321-pooler.eu-west-2.aws.neon.tech/neondb";

describe("databaseIdentity", () => {
  it("treats the pooled and direct endpoints of one branch as the same database", () => {
    // The bypass this exists to close. Neon's pooled host is the direct host
    // with `-pooler` inserted into the same endpoint id, so comparing raw hosts
    // would call these two different — and let the suite truncate the app's own
    // database, pasted in as the "test" one in its other form.
    expect(databaseIdentity(POOLED, "DATABASE_URL_TEST")).toBe(
      databaseIdentity(DIRECT, "DATABASE_URL"),
    );
  });

  it("keeps separate branches separate", () => {
    // The normalisation must not be so eager that it collapses the legitimate
    // configuration — two different branches — into a false collision, which
    // would make the suite refuse to run at all.
    expect(databaseIdentity(POOLED, "DATABASE_URL_TEST")).not.toBe(
      databaseIdentity(OTHER_BRANCH, "DATABASE_URL"),
    );
  });

  it("strips `-pooler` only as the endpoint suffix", () => {
    // A host that merely contains the word keeps it: the suffix is followed by a
    // dot, and anything else is part of the name.
    expect(databaseIdentity("postgresql://u:p@my-pooler-db.example.com/app", "X")).toBe(
      "my-pooler-db.example.com",
    );
  });

  it("keeps the port, so two databases on one host stay distinct", () => {
    expect(databaseIdentity("postgresql://u:p@localhost:5433/app", "X")).toBe("localhost:5433");
    expect(databaseIdentity("postgresql://u:p@localhost:5433/app", "X")).not.toBe(
      databaseIdentity("postgresql://u:p@localhost:5432/app", "X"),
    );
  });

  it("names the variable, and nothing else, when a string will not parse", () => {
    // The message reaches CI logs, so it must carry the variable's name and not
    // one character of its value — the first few alone carry the username.
    expect(() => databaseIdentity("not a url", "DATABASE_URL_TEST")).toThrow(
      "Could not parse DATABASE_URL_TEST as a URL.",
    );
  });
});
