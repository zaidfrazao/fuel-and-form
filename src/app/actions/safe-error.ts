/**
 * What a walk action is allowed to write to the log when it fails.
 *
 * ## The whole trace can reach a log line, and it does so through DETAIL
 *
 * `console.error("…", error)` on a Postgres constraint violation prints the
 * driver's error object, and its `detail` is *"Failing row contains (…)"* —
 * the whole row. For `walk_routes` that is every coordinate of the walk AND
 * the route's name. Observed directly while writing FUEL-102's isolation
 * tests: one violated CHECK printed a full point array and a route name into
 * the terminal.
 *
 * PRD § P11's rules are about the repository and the export, and an operator's
 * own log is neither — the operator can already read the database. But this is
 * a public portfolio app with a demo anybody can open, so the rows in question
 * are not only the owner's, and a log is a surface with a different lifetime,
 * a different access path and a different set of people looking at it. Nothing
 * is gained by putting a stranger's route in one.
 *
 * So the message and the Postgres error code cross, and nothing else. The code
 * is what actually makes a failure diagnosable — `23514` names the constraint
 * class, `23505` a duplicate — and neither it nor the message carries a row.
 *
 * Only the walk actions need this. Every other action in this directory logs
 * its raw error deliberately, and should: none of them handles a location.
 *
 * ## A module of its own, with no imports
 *
 * It began inside `resolve-walk.ts` and had to move: that file reaches the
 * database, so importing it from a test drags `server-only` in and the suite
 * fails at import with `(0 test)`. A pure formatter behind a server-only chain
 * is a pure formatter nothing can test, which is the wrong home for the one
 * function whose whole job is to be exactly right about what it prints.
 */
export function safeError(error: unknown): string {
  if (error instanceof Error) {
    // `code` is Postgres's SQLSTATE, which the Neon driver hangs on the error.
    // Read defensively — a network failure is an Error with no code at all.
    const code = (error as { code?: unknown }).code;

    return typeof code === "string"
      ? `${error.name}: ${error.message} [${code}]`
      : `${error.name}: ${error.message}`;
  }

  // Never the value itself: a thrown non-Error could be anything, including a
  // row. Its type is the most that can be said about it safely.
  return `non-Error thrown (${typeof error})`;
}
