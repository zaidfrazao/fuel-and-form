import type { WorkoutExercise } from "./db/schema";

/**
 * Form reference media — § P10, FUEL-94.
 *
 * An image or short clip showing how an exercise is performed. This module says
 * what media the app HAS, what may be done with each piece of it, and how a
 * stored row becomes something safe to render. `workout_exercises.media_key`
 * says which asset an exercise points at; everything else about that asset lives
 * here.
 *
 * ## The database stores a key, and this file owns the path
 *
 * The ticket's shape was `media_path`, and the rename to `media_key` is the
 * whole security argument made in one word. A column is writable. A public app
 * that interpolates a stored string into `src` has handed out an embed — anyone
 * who can write that column chooses what the app loads and from where, and
 * `src="https://…"` is a perfectly good relative-looking string to a browser
 * that has already resolved it.
 *
 * So no stored value ever reaches a `src`. A row names a key; the key is looked
 * up in `FORM_MEDIA` below; the PATH comes from the manifest entry, which is a
 * compile-time constant in this repository. A key that is not in the manifest
 * resolves to `null` and the exercise renders no affordance — the same state as
 * an exercise that never had media, which is the state most of them are in.
 *
 * That is what makes the acceptance criterion structural rather than diligent:
 * "an arbitrary stored value cannot become a media source" is true because there
 * is no code path from a column to a URL, not because a check is applied
 * carefully everywhere.
 *
 * ## `Object.hasOwn`, and why a bare lookup would be the bug it exists to stop
 *
 * `FORM_MEDIA[key]` on a plain object consults `Object.prototype`. A row storing
 * `constructor` gets back a function; `toString` gets back a function; both are
 * truthy, and a resolver that tested only for truthiness would then read `.path`
 * off them and hand `undefined` to an `<img>`. The lookup is guarded by
 * `Object.hasOwn` for that reason and the test suite stores those exact strings.
 *
 * ## Provenance is recorded per asset, beside the asset
 *
 * **This repository is public.** Media the project has no right to redistribute
 * is a licensing problem no amount of correct code fixes, and it would ship in a
 * portfolio piece specifically intended to be looked at. Every entry therefore
 * carries where it came from, who made it, under what licence, and when it was
 * retrieved — as data, in the same object as the path, so that the record cannot
 * drift from the thing it describes the way a README would.
 *
 * The allowlist is CC0, public domain and CC BY (FUEL-94's ruling). Where a
 * licence requires attribution, `creditFor` builds the line and the sheet
 * renders it; that is not a nicety, it is the licence's condition for the
 * app being allowed to show the asset at all.
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
 * out. A third kind is a plausible future — an animated sequence of stills is
 * neither of these — so it takes the same answer as the two vocabularies either
 * side of it rather than a different one in the same table.
 */
export const MEDIA_KINDS = ["image", "video"] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * The licences this repository will carry, and what each one demands.
 *
 * Not an open vocabulary and deliberately unlike the two above: this is the
 * allowlist itself. Widening it is a decision about what the public repo
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
  "cc-by-2.0": {
    name: "CC BY 2.0",
    url: "https://creativecommons.org/licenses/by/2.0/",
    requiresAttribution: true,
  },
  "cc-by-3.0": {
    name: "CC BY 3.0",
    url: "https://creativecommons.org/licenses/by/3.0/",
    requiresAttribution: true,
  },
  "cc-by-4.0": {
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    requiresAttribution: true,
  },
  /*
   * Share-alike, admitted deliberately and on a narrow reading.
   *
   * FUEL-94's first ruling put the allowlist at CC0, public domain and CC BY.
   * The audit that followed found that pool to be almost entirely CONTEXTUAL
   * photography — someone performing an exercise in a gym or a barracks — while
   * the one purpose-built instructional library on Commons is CC BY-SA
   * throughout. The allowlist and the only usable assets did not overlap.
   *
   * Share-alike binds ADAPTATIONS. These files ship byte-identical, displayed
   * with attribution and a link to the licence, which is verbatim
   * redistribution and is exactly what the licence grants. Nothing here is
   * cropped, recoloured, combined or re-encoded — and that is a constraint on
   * whoever adds the next one, not merely a description of these four.
   *
   * `dark:invert` in `form-media-sheet.tsx` is a CSS filter applied at display
   * time. It does not modify the file and nothing derived from it is
   * distributed, so it is presentation rather than adaptation.
   */
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
} as const satisfies Record<string, Licence>;

export type Licence = {
  readonly name: string;
  readonly url: string;
  readonly requiresAttribution: boolean;
};

export type LicenceKey = keyof typeof LICENCES;

/** One bundled asset: what it is, where it sits, and where it came from. */
export type FormMediaAsset = {
  /**
   * Relative to the bundle root — `/form/…`, served from `public/form/`.
   *
   * Written as a literal in this file and never composed from anything, so
   * grepping this array is the complete list of what the feature can load.
   */
  readonly path: string;
  readonly kind: MediaKind;
  /**
   * The asset's intrinsic pixel size, so the box is reserved before it loads.
   *
   * Not decoration and not duplication: without them the sheet reflows when the
   * media arrives, which is layout shift on the one screen FUEL-52 measures.
   * They are a property of the file, so they live with it rather than being
   * guessed at a call site, and `npm run check:form-media` reads them back off
   * the real file so they cannot drift from it.
   */
  readonly width: number;
  readonly height: number;
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
 * Adding media for a new exercise is a commit — that is the cost the ticket
 * accepts in exchange for no storage service, no signed URLs, no upload UI and
 * no third-party player, which is what keeps PRD § Integrations' "None. No
 * third-party APIs" literally true. With a fixed workout library it is the right
 * trade; it stops being the right trade the day the library stops being fixed.
 *
 * ## Look at the picture. The filename is not the exercise.
 *
 * Everkinetic is a GYM library, and its names describe neither the equipment nor
 * the variant. FUEL-94's audit rejected three files that a licence check alone
 * would have passed: `Squats-1/2.png` is a **barbell back squat**,
 * `Lunges-1/2.png` is a **barbell lunge**, and `Push-up-1/2.png` is a push-up
 * **on an exercise ball** — all of them wrong for a bodyweight programme, and
 * all of them implying equipment the user does not have. The usable push-up is a
 * different file under a different naming convention.
 *
 * Which is why coverage is five exercises rather than fourteen: no bodyweight
 * squat and no front plank exist in the set under any name probed. Those rows
 * hold nulls and draw nothing, which is a state this module treats as ordinary.
 *
 * ## Byte-identical, and that is a constraint on the next entry
 *
 * Everything here is CC BY-SA. Nothing is cropped, recoloured, combined or
 * re-encoded; see `LICENCES` above on why that distinction is the licence's
 * rather than a preference.
 */
export const FORM_MEDIA = {
  "push-up": {
    path: "/form/push-up.svg",
    kind: "image",
    width: 1200,
    height: 669,
    author: "Everkinetic",
    licence: "cc-by-sa-3.0",
    source: "https://commons.wikimedia.org/wiki/File:Push_ups_2.svg",
    retrieved: "2026-09-03",
  },
  "glute-bridge": {
    path: "/form/glute-bridge.png",
    kind: "image",
    width: 900,
    height: 444,
    author: "Everkinetic",
    licence: "cc-by-sa-3.0",
    source: "https://commons.wikimedia.org/wiki/File:Bridge-1.png",
    retrieved: "2026-09-03",
  },
  "side-plank": {
    path: "/form/side-plank.svg",
    kind: "image",
    width: 1200,
    height: 554,
    author: "Everkinetic",
    licence: "cc-by-sa-3.0",
    source: "https://commons.wikimedia.org/wiki/File:Side_plank_1.svg",
    retrieved: "2026-09-03",
  },
  superman: {
    path: "/form/superman.svg",
    kind: "image",
    width: 1200,
    height: 266,
    author: "Everkinetic",
    licence: "cc-by-sa-3.0",
    source: "https://commons.wikimedia.org/wiki/File:Supermans_2.svg",
    retrieved: "2026-09-03",
  },
} as const satisfies Record<string, FormMediaAsset>;

export type FormMediaKey = keyof typeof FORM_MEDIA;

/** What a component gets: everything it needs, and no stored string. */
export type ResolvedFormMedia = {
  readonly key: string;
  readonly path: string;
  readonly kind: MediaKind;
  readonly width: number;
  readonly height: number;
  /**
   * What the movement IS, in words — § Accessibility, to FUEL-50's standard.
   *
   * Not "video of a squat". The media is the content of this sheet, so a reader
   * who cannot see it gets nothing at all from a label that names the file
   * instead of describing the movement. It is rendered as visible text beside
   * the media as well as carried as the alt, for the same reason § Accessibility
   * gives the signature graphics an adjacent data table: "a mark on a screen is
   * not the data".
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
 * `null` is not an error state and is not reported as one. It is what most
 * exercises are: FUEL-94 ships media for the ones it could licence, and an
 * exercise without it "renders no affordance and no gap".
 *
 * Every rejection below is a row that would otherwise draw a broken box:
 *
 * - **No key.** The ordinary case, and the reason the column is nullable.
 * - **A key the manifest does not have.** The validation the ticket asks for.
 *   Own-property only; see the header on `Object.hasOwn`.
 * - **No alt.** Media with no description is not shippable under
 *   § Accessibility, so a row missing one renders nothing rather than rendering
 *   an image a screen reader announces as its filename. Whitespace is not a
 *   description, so it is trimmed before the test.
 * - **A kind disagreeing with the manifest.** The column is denormalised — the
 *   file's kind is a property of the file — so the two can only differ if one
 *   was edited without the other. Rendering the manifest's kind and ignoring the
 *   column would hide that; rendering the column's kind would put a `<video>`
 *   around a JPEG. Neither is better than drawing nothing and neither is
 *   something the reader can act on, so the row is refused.
 */
export function resolveFormMedia(row: FormMediaColumns): ResolvedFormMedia | null {
  const key = row.mediaKey?.trim();
  if (!key) return null;

  if (!Object.hasOwn(FORM_MEDIA, key)) return null;
  const asset = (FORM_MEDIA as Record<string, FormMediaAsset>)[key];
  if (!asset) return null;

  const alt = row.mediaAlt?.trim();
  if (!alt) return null;

  if (row.mediaKind && row.mediaKind !== asset.kind) return null;

  return {
    key,
    path: asset.path,
    kind: asset.kind,
    width: asset.width,
    height: asset.height,
    alt,
    credit: creditFor(asset, row.mediaCredit),
    licence: LICENCES[asset.licence],
  };
}
