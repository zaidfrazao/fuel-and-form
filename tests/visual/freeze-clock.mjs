/**
 * Pins the server's wall clock, so a baseline taken today still matches in a
 * month's time.
 *
 * Loaded into the `next start` process with `--import` (see playwright.config.ts).
 * It is never imported by the application and never runs outside the visual
 * suite.
 *
 * ## Why the clock, and not a mask
 *
 * FUEL-69 offered a choice: freeze the clock, or mask the date-bearing regions.
 * Masking cannot work here. The demo's history is generated relative to now, so
 * a Wednesday run and a Saturday run differ *structurally* and not merely in
 * their labels — the week grid's today column sits somewhere else, the day
 * ruler's NOW mark sits somewhere else, and the weight chart is a different
 * shape because it plots a different twelve weeks. There is no rectangle that
 * covers that. A mask would hide the text and leave the geometry drifting, which
 * is the worst of both: a suite that still fails most mornings, for reasons its
 * own masks have made invisible.
 *
 * Threading a fake `now` through the application instead was rejected as the
 * larger change: there are 29 live `new Date()` sites in `src/`, and rewriting
 * them for a test harness would put test seams into production paths. This file
 * is 40 lines and touches nothing.
 *
 * What makes the result *stable* rather than merely fixed is
 * `src/lib/seed/history.ts`, which states at its head: "Nothing here calls
 * `Math.random()`. Every varying value is a pure function of" the date. Hold the
 * date still and the entire demo library is byte-identical between runs. Were
 * that ever to stop being true, these baselines would flap and this comment is
 * where to start looking.
 *
 * ## Stopped, not ticking
 *
 * `Date.now()` returns a constant. It did not at first: it returned
 * `frozen + (real elapsed since this module loaded)`, on the theory that a
 * stopped clock might hang anything waiting for a duration to become positive.
 *
 * That was wrong, and the suite caught it. Three baselines failed on a second
 * run — `right-now`, dark, at 820, 1272 and 1920 — and the diff was 35 to 89
 * pixels confined to the day ruler's NOW mark and its pill. The ruler positions
 * that mark from the current minute of the day, so a screen rendered ninety
 * seconds into one run and a hundred and ten into the next drew it a pixel or
 * two apart. The base was stable; the offset was not.
 *
 * Nothing hangs, because nothing in Node measures a duration with `Date.now()`
 * where it matters: `setTimeout` and `AbortSignal.timeout` run off the monotonic
 * clock, which this file does not touch.
 *
 * The cost of stopping it is that genuine elapsed time reads as zero everywhere.
 * For a suite that loads pages and photographs them, that is not a cost at all.
 */

const iso = process.env.FUEL_FROZEN_NOW;

if (!iso) {
  throw new Error(
    "FUEL_FROZEN_NOW is not set, so the clock cannot be frozen and every " +
      "baseline would drift. playwright.config.ts sets it; this file is not " +
      "meant to be loaded by anything else.",
  );
}

const frozen = Date.parse(iso);

if (Number.isNaN(frozen)) {
  // The value itself is safe to print — it is a timestamp, not a secret — and
  // without it the reader cannot tell a typo from an unset variable.
  throw new Error(`FUEL_FROZEN_NOW is not a parseable instant: ${iso}`);
}

const RealDate = Date;

/** The same instant, every time it is asked. See "Stopped, not ticking" above. */
const now = () => frozen;

/**
 * Subclassed rather than patched onto the original, so that `instanceof Date`,
 * `Object.prototype.toString` and every inherited static (`Date.parse`,
 * `Date.UTC`) keep working untouched. Only the two ways of reading the *current*
 * time are redirected; `new Date(someIsoString)` is left entirely alone, which
 * matters because most dates in this app are parsed from the database rather
 * than read off the clock.
 */
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(now());
    } else {
      super(...args);
    }
  }
}

/**
 * `UTC` and `parse` copied across as OWN properties, rather than left to be
 * inherited through `extends`.
 *
 * Subclassing already puts `RealDate` on the prototype chain, so `FrozenDate.UTC`
 * resolves perfectly well in plain Node — verified. It does not survive every
 * consumer: Next's build evaluates page modules in a sandbox that carries the
 * patched global's *own* properties onto a fresh object, and inherited statics
 * are silently dropped on the way. The symptom is `TypeError: Date.UTC is not a
 * function` thrown from application code that has done nothing wrong.
 *
 * Copying the descriptors makes the shim indifferent to how any given host
 * reconstructs a global. `prototype`, `name` and `length` are deliberately not
 * copied — a class's `prototype` is non-writable and redefining it throws.
 */
for (const key of ["UTC", "parse"]) {
  Object.defineProperty(FrozenDate, key, Object.getOwnPropertyDescriptor(RealDate, key));
}

/** Defined after the copy, so it is not overwritten by the real `Date.now`. */
Object.defineProperty(FrozenDate, "now", {
  value: now,
  writable: true,
  enumerable: false,
  configurable: true,
});

globalThis.Date = FrozenDate;
