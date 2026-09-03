import type { WorkoutExercise } from "./db/schema";

/**
 * Form reference media — § P10, FUEL-94, rebuilt as photographs by FUEL-107.
 *
 * Photographs of a person performing each exercise. This module says what media
 * the app HAS, what may be done with each piece of it, and how a stored row
 * becomes something safe to render. `workout_exercises.media_key` says which
 * asset an exercise points at; everything else about that asset lives here.
 *
 * ## Why photographs, when FUEL-94 shipped drawings
 *
 * FUEL-94 shipped monochrome line art, which was the right answer to the
 * question it asked — it was theme-perfect, tiny, and unambiguously licensed.
 * It was the wrong answer to the question the reader has, which is "how deep,
 * and where does my knee go". A drawing of a stick figure does not settle that.
 * This screen exists to be useful mid-set, so legibility outranks the register.
 *
 * The register is therefore spent rather than kept, and § Materials records it.
 *
 * ## The database stores a key, and this file owns the path
 *
 * Unchanged from FUEL-94, and it is the whole security argument in one word. A
 * column is writable. A public app that interpolates a stored string into `src`
 * has handed out an embed — anyone who can write that column chooses what the
 * app loads and from where, and `src="https://…"` is a perfectly good
 * relative-looking string to a browser that has already resolved it.
 *
 * So no stored value ever reaches a `src`. A row names a key; the key is looked
 * up in `FORM_MEDIA` below; the PATHS come from the manifest entry, which is a
 * compile-time constant in this repository. A key that is not in the manifest
 * resolves to `null` and the exercise renders no affordance.
 *
 * ## Frames live here, which is why FUEL-107 needed no migration
 *
 * An exercise now shows TWO photographs — the start and the working position —
 * because one still cannot show a movement. How many frames an asset has is a
 * property of the asset, not of the exercise pointing at it, so it belongs in
 * the manifest and the database never learned about it. `media_key` still names
 * one entry; the entry simply holds more than it did.
 *
 * ## `Object.hasOwn`, and why a bare lookup would be the bug it exists to stop
 *
 * `FORM_MEDIA[key]` on a plain object consults `Object.prototype`. A row storing
 * `constructor` gets back a function; `toString` gets back a function; both are
 * truthy, and a resolver that tested only for truthiness would then read
 * `.frames` off them and hand `undefined` to a renderer. `isFormMediaKey` guards
 * it, and the test suite stores those exact strings.
 *
 * ## Provenance, recorded truthfully rather than optimistically
 *
 * **This repository is public**, and the honesty of this block is the whole
 * mitigation. See `UNDOCUMENTED` and the `unlicense-declared` licence below:
 * these assets are shipped on a declaration this project does not fully believe,
 * as an accepted risk, and every entry says so in the file rather than in
 * somebody's memory. That is what makes "remove the images" a grep instead of an
 * archaeology session.
 *
 * ## Pure, and only a TYPE import from the schema
 *
 * `section.ts`'s rule, for `section.ts`'s reason: the client imports this to
 * decide whether to draw a button, so it must pull no `pg-core`. The schema
 * imports `MEDIA_KINDS` back for its CHECK, exactly as it imports `SECTIONS`,
 * so the constraint and the code that reads it are built from one array.
 */

/**
 * What a piece of media IS, as far as rendering is concerned.
 *
 * `text` + a CHECK rather than a `pgEnum`, which is `workouts.type`'s argument
 * and `workout_exercises.section`'s: a new value would otherwise be
 * `ALTER TYPE … ADD VALUE`, a migration, which the PRD's gym-restart claim rules
 * out.
 *
 * Note that "how many frames" is NOT a kind. A still and a two-frame sequence
 * are both `image`; the difference is the length of `frames`, which is data
 * rather than vocabulary and so needs no constraint and no migration.
 */
export const MEDIA_KINDS = ["image", "video"] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * What this repository will say about an asset whose creator it cannot name.
 *
 * A constant rather than a string typed twelve times, so that the count of
 * assets in this state is a grep and cannot drift into a comfortable-sounding
 * paraphrase on the thirteenth.
 */
const UNDOCUMENTED = "Not documented upstream";

/**
 * The licences this repository will carry, and what each one demands.
 *
 * Not an open vocabulary and deliberately unlike `MEDIA_KINDS`: this is the
 * allowlist itself. Widening it is a decision about what a public repo
 * redistributes, which is exactly the decision that should cost an edit here
 * rather than being reachable by writing a new string into a column.
 */
export const LICENCES = {
  cc0: {
    name: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    requiresAttribution: false,
  },
  "public-domain": {
    name: "Public domain",
    url: "https://en.wikipedia.org/wiki/Public_domain",
    requiresAttribution: false,
  },
  "cc-by-4.0": {
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    requiresAttribution: true,
  },
  "cc-by-sa-3.0": {
    name: "CC BY-SA 3.0",
    url: "https://creativecommons.org/licenses/by-sa/3.0/",
    requiresAttribution: true,
  },
  "cc-by-sa-4.0": {
    name: "CC BY-SA 4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    requiresAttribution: true,
  },
  /*
   * An upstream DECLARATION of public domain, which is not the same thing as
   * public domain — and the difference is recorded rather than smoothed over.
   *
   * `yuhonas/free-exercise-db` and its upstream `wrkout/exercises.json` both
   * declare the Unlicense over ~876 exercises. The photographs are plainly
   * professional studio work — paid models, branded sets, commercial lighting —
   * and NEITHER repository documents where they came from. A third party
   * declaring the Unlicense over photographs they did not shoot does not place
   * those photographs in the public domain.
   *
   * They ship anyway. That is a deliberate, informed decision by the repository
   * owner, who weighed a takedown demand or a back-licensing invoice against the
   * feature being legible enough to be worth having, and chose the feature. The
   * job of this entry is not to launder that choice but to keep it visible: an
   * asset carrying this licence key is one whose provenance ends at a
   * declaration, and `author` is `UNDOCUMENTED` because that is the truth.
   *
   * `requiresAttribution: false` because the declaration asks for none — not
   * because the original creator would not have. If a demand ever arrives, every
   * affected file is `grep -l 'unlicense-declared'` away.
   */
  "unlicense-declared": {
    name: "Unlicense (declared upstream)",
    url: "https://unlicense.org/",
    requiresAttribution: false,
  },
} as const satisfies Record<string, Licence>;

export type Licence = {
  readonly name: string;
  readonly url: string;
  readonly requiresAttribution: boolean;
};

export type LicenceKey = keyof typeof LICENCES;

/** One photograph: where it sits, how big it is, and what moment it shows. */
export type MediaFrame = {
  /**
   * Relative to the bundle root — `/form/…`, served from `public/form/`.
   *
   * Written as a literal and never composed from anything, so grepping this
   * file is the complete list of what the feature can load.
   */
  readonly path: string;
  /**
   * The file's intrinsic pixel size, so the box is reserved before it loads.
   *
   * Without them the sheet reflows as each photograph arrives, which is layout
   * shift on the one screen FUEL-52 measures — and with two frames it would
   * happen twice. `tests/unit/form-media-assets.test.ts` reads these back off
   * the real files so they cannot drift.
   */
  readonly width: number;
  readonly height: number;
  /** The moment shown — "Standing", "Bottom of the squat". Rendered. */
  readonly label: string;
};

/** One bundled asset: what it is, what it shows, and where it came from. */
export type FormMediaAsset = {
  readonly kind: MediaKind;
  /** In order. Two for every asset today: the start and the working position. */
  readonly frames: readonly MediaFrame[];
  /** Who made it, spelled as the licence's attribution requires. */
  readonly author: string;
  readonly licence: LicenceKey;
  /** Where it came from, so the claim above can be checked by a reader. */
  readonly source: string;
  /** ISO date the file was retrieved, so a later licence change is traceable. */
  readonly retrieved: string;
};

/**
 * Every asset the app ships. The keys are what `media_key` may hold.
 *
 * Twelve assets covering thirteen of the fourteen working exercises — the squat
 * serves both Squats and Squat pulses, which is what `media_alt` being per
 * EXERCISE rather than per asset is for: one file, two movements, two
 * descriptions.
 *
 * **Skipping intervals deliberately has none.** The source's "Fast Skipping" is
 * a plyometric bounding drill with no rope in frame — it is not the exercise,
 * and the exercise cannot be swapped for one that is because it names the whole
 * session. A form reference showing a different movement is worse than none.
 *
 * ## Look at the picture. The filename is not the exercise.
 *
 * Every asset here was opened and viewed before it was committed, and that pass
 * is not optional. FUEL-94 rejected three files on it — `Squats` was a barbell
 * back squat, `Lunges` a barbell lunge, `Push-up` a push-up on an exercise ball
 * — all of which a licence check alone would have passed. This ticket rejected
 * more: `Hanging Pike` is a hanging leg raise, `Push Up to Side Plank` is a
 * dynamic movement rather than the hold, and `Bodyweight Walking Lunge` is
 * photographed on a busy gym floor and unreadable at 375px.
 */
export const FORM_MEDIA = {
  squat: {
    kind: "image",
    frames: [
      { path: "/form/squat-1.jpg", width: 850, height: 567, label: "Standing" },
      { path: "/form/squat-2.jpg", width: 850, height: 567, label: "Bottom of the squat" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Bodyweight_Squat",
    retrieved: "2026-09-03",
  },
  "push-up": {
    kind: "image",
    frames: [
      { path: "/form/push-up-1.jpg", width: 850, height: 567, label: "Top" },
      { path: "/form/push-up-2.jpg", width: 850, height: 567, label: "Bottom of the push-up" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Pushups",
    retrieved: "2026-09-03",
  },
  "reverse-lunge": {
    kind: "image",
    frames: [
      { path: "/form/reverse-lunge-1.jpg", width: 850, height: 567, label: "Standing" },
      { path: "/form/reverse-lunge-2.jpg", width: 850, height: 567, label: "Bottom of the lunge" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Crossover_Reverse_Lunge",
    retrieved: "2026-09-03",
  },
  "glute-bridge": {
    kind: "image",
    frames: [
      { path: "/form/glute-bridge-1.jpg", width: 850, height: 567, label: "Hips down" },
      { path: "/form/glute-bridge-2.jpg", width: 850, height: 567, label: "Hips lifted" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Butt_Lift_Bridge",
    retrieved: "2026-09-03",
  },
  plank: {
    kind: "image",
    frames: [
      { path: "/form/plank-1.jpg", width: 850, height: 567, label: "Set-up" },
      { path: "/form/plank-2.jpg", width: 850, height: 567, label: "Holding the plank" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Plank",
    retrieved: "2026-09-03",
  },
  "bench-dip": {
    kind: "image",
    frames: [
      { path: "/form/bench-dip-1.jpg", width: 850, height: 567, label: "Arms straight" },
      { path: "/form/bench-dip-2.jpg", width: 850, height: 567, label: "Bottom of the dip" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Bench_Dips",
    retrieved: "2026-09-03",
  },
  "split-squat": {
    kind: "image",
    frames: [
      { path: "/form/split-squat-1.jpg", width: 850, height: 567, label: "Standing" },
      { path: "/form/split-squat-2.jpg", width: 850, height: 567, label: "Bottom of the split squat" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Split_Squats",
    retrieved: "2026-09-03",
  },
  "single-leg-glute-bridge": {
    kind: "image",
    frames: [
      { path: "/form/single-leg-glute-bridge-1.jpg", width: 850, height: 567, label: "Hips down" },
      { path: "/form/single-leg-glute-bridge-2.jpg", width: 850, height: 567, label: "Hips lifted, one leg raised" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Single_Leg_Glute_Bridge",
    retrieved: "2026-09-03",
  },
  "mountain-climber": {
    kind: "image",
    frames: [
      { path: "/form/mountain-climber-1.jpg", width: 850, height: 567, label: "Plank position" },
      { path: "/form/mountain-climber-2.jpg", width: 850, height: 567, label: "Knee driven forward" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Mountain_Climbers",
    retrieved: "2026-09-03",
  },
  superman: {
    kind: "image",
    frames: [
      { path: "/form/superman-1.jpg", width: 850, height: 567, label: "Lying flat" },
      { path: "/form/superman-2.jpg", width: 850, height: 567, label: "Chest and thighs lifted" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Superman",
    retrieved: "2026-09-03",
  },
  "dead-bug": {
    kind: "image",
    frames: [
      { path: "/form/dead-bug-1.jpg", width: 1280, height: 720, label: "Start" },
      { path: "/form/dead-bug-2.jpg", width: 1280, height: 720, label: "Opposite arm and leg extended" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Dead_Bug",
    retrieved: "2026-09-03",
  },
  "side-plank": {
    kind: "image",
    frames: [
      { path: "/form/side-plank-1.jpg", width: 850, height: 567, label: "Set-up" },
      { path: "/form/side-plank-2.jpg", width: 850, height: 567, label: "Holding the side plank" },
    ],
    author: UNDOCUMENTED,
    licence: "unlicense-declared",
    source: "https://github.com/yuhonas/free-exercise-db/tree/main/exercises/Side_Bridge",
    retrieved: "2026-09-03",
  },
} as const satisfies Record<string, FormMediaAsset>;

export type FormMediaKey = keyof typeof FORM_MEDIA;

/** What a component gets: everything it needs, and no stored string. */
export type ResolvedFormMedia = {
  readonly key: string;
  readonly kind: MediaKind;
  readonly frames: readonly MediaFrame[];
  /**
   * What the movement IS, in words — § Accessibility, to FUEL-50's standard.
   *
   * Not "photo of a squat". The media is the content of this sheet, so a reader
   * who cannot see it gets nothing at all from a label that names the file
   * instead of describing the movement. It is rendered as visible text beside
   * the photographs as well as being what they are announced against, for the
   * reason § Accessibility gives the signature graphics an adjacent data table:
   * "a mark on a screen is not the data".
   */
  readonly alt: string;
  /** The attribution line, where the licence requires one. Else `null`. */
  readonly credit: string | null;
  readonly licence: Licence;
};

/** The columns this module reads. A subset, so callers may pass a whole row. */
export type FormMediaColumns = Pick<
  WorkoutExercise,
  "mediaKey" | "mediaKind" | "mediaAlt" | "mediaCredit"
>;

/**
 * Whether a stored string names an asset this app ships — a type guard.
 *
 * `Object.hasOwn` rather than a bare index, and that is the whole point: reading
 * `FORM_MEDIA[key]` on a plain object consults `Object.prototype`, so a row
 * storing `constructor`, `toString`, `valueOf`, `hasOwnProperty` or
 * `__defineGetter__` gets back a truthy FUNCTION. A caller testing only for
 * truthiness would then read `.frames` off it and hand `undefined` to a
 * renderer.
 *
 * Written as a guard so the narrowing is carried in the TYPE rather than undone
 * by a cast at the call site.
 */
function isFormMediaKey(key: string): key is FormMediaKey {
  return Object.hasOwn(FORM_MEDIA, key);
}

/** The attribution line a licence requires, or `null` where none is required. */
export function creditFor(asset: FormMediaAsset, override: string | null): string | null {
  const licence = LICENCES[asset.licence];
  if (!licence.requiresAttribution) return override?.trim() || null;

  const trimmed = override?.trim();
  return trimmed || `${asset.author} · ${licence.name}`;
}

/**
 * A stored row, resolved into something renderable — or `null`.
 *
 * `null` is not an error state and is not reported as one. It is what an
 * exercise without media is, and the screen draws no affordance for it.
 *
 * Every rejection below is a row that would otherwise draw a broken box:
 *
 * - **No key.** The ordinary case, and the reason the column is nullable.
 * - **A key the manifest does not have.** The validation the ticket asks for.
 *   Own-property only; see `isFormMediaKey`.
 * - **No alt.** Media with no description is not shippable under
 *   § Accessibility, so a row missing one renders nothing rather than rendering
 *   photographs a screen reader announces as filenames. Whitespace is not a
 *   description, so it is trimmed before the test.
 * - **A kind that is absent, or disagrees with the manifest.** The column is
 *   denormalised — the file's kind is a property of the file — so the two can
 *   only differ if one was edited without the other. Absence is refused on the
 *   same footing: the database's pairing CHECK already forbids a key without a
 *   kind, and a resolver weaker than the constraint it mirrors only differs
 *   where the constraint is missing, which is precisely where the fault should
 *   be visible.
 */
export function resolveFormMedia(row: FormMediaColumns): ResolvedFormMedia | null {
  const key = row.mediaKey?.trim();
  if (!key) return null;

  if (!isFormMediaKey(key)) return null;
  const asset: FormMediaAsset = FORM_MEDIA[key];

  const alt = row.mediaAlt?.trim();
  if (!alt) return null;

  if (row.mediaKind !== asset.kind) return null;

  return {
    key,
    kind: asset.kind,
    frames: asset.frames,
    alt,
    credit: creditFor(asset, row.mediaCredit),
    licence: LICENCES[asset.licence],
  };
}
