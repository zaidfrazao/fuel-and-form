"use client";

import { Sheet } from "@/components/ui/sheet";
import type { MediaFrame, ResolvedFormMedia } from "@/lib/form-media";

/**
 * Form reference media, revealed — § P10, FUEL-94, photographs since FUEL-107.
 *
 * What the session state's "Show form" button opens. One exercise, its
 * photographs, the movement in words, and any attribution the licence requires.
 *
 * ## Why a sheet, when the guide bans most of the alternatives
 *
 * § Progressive Disclosure: "No modals, no accordions, no tabs within a screen."
 * That leaves the bottom sheet, which is the app's only disclosure device and
 * already carries the meal picker and the swap preview. FUEL-90's ruling on this
 * ticket says the reveal "may not mean a row that expands in place" — that is
 * the accordion the whole session state exists to avoid — and that
 * § Progressive Disclosure's "one question per screen" binds what it opens. One
 * question: how is this performed. So the sheet holds the media, the words for
 * it, and nothing else — no set logging, no navigation to the next exercise.
 *
 * § Sheets holds it to the measure's column at every width, so this component
 * states no width of its own. It caps at 85dvh and scrolls, which is what lets
 * two photographs stack rather than being shrunk to fit.
 *
 * ## Two frames, stacked rather than side by side
 *
 * A movement needs a start and a working position; one still cannot show it, and
 * that is the whole reason FUEL-107 replaced the drawings. They stack because
 * side by side at 375px gives each about 160px of width, which is smaller than
 * the drawing this ticket replaced FOR being too small to read. Height is the
 * cheap axis here — the sheet scrolls, and the reader has already chosen to look.
 *
 * ## The description is rendered, not just announced
 *
 * § Accessibility gives the signature graphics "an accessible summary plus an
 * adjacent data table", on the reasoning that "a mark on a screen is not the
 * data". Media is the same case and more so: the pictures ARE the content of
 * this sheet, so the words for them are content too, and putting them only in
 * `alt` would mean a sighted reader who cannot interpret the photographs — which
 * is most people, for most exercises, which is why the sheet exists — gets
 * nothing the screen reader user gets.
 *
 * ## Attribution is a licence condition, not a courtesy
 *
 * Where `credit` is non-null the licence requires it, and it renders with a link
 * to the licence text. Where it is null the licence asks for none, and the sheet
 * shows nothing rather than naming a creator this project cannot identify —
 * see `unlicense-declared` in `lib/form-media.ts` on why that distinction is
 * load-bearing rather than pedantic.
 */
export function FormMediaSheet({
  open,
  onOpenChange,
  exerciseName,
  media,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exerciseName: string;
  media: ResolvedFormMedia;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Form · ${exerciseName}`}>
      <div className="flex flex-col gap-5">
        {media.kind === "video" ? (
          <Figure frame={media.frames[0]!} kind="video" alt={media.alt} />
        ) : (
          media.frames.map((frame) => (
            <Figure key={frame.path} frame={frame} kind="image" alt={frame.label} />
          ))
        )}

        {/* The movement, in words. `text-body` and not a caption: this is the
            content of the sheet and is sized as content. */}
        <p className="text-body text-text-primary">{media.alt}</p>

        {media.credit ? (
          /* § Slash Metadata marks a secondary fact with a leading `/ `. The
             attribution is secondary to the movement and primary to the
             licence, which is exactly what that register is for. */
          <p className="text-slash text-text-tertiary">
            {`/ ${media.credit} · `}
            <a
              href={media.licence.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-text-tertiary underline-offset-4"
            >
              Licence
            </a>
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * One frame, framed and captioned.
 *
 * `frame.path` comes from `FORM_MEDIA`, which is a compile-time constant. No
 * stored value reaches this function; see `lib/form-media.ts` on why that is the
 * shape of the whole feature rather than a detail of it.
 *
 * ## No `dark:invert`, and its removal is the point rather than an omission
 *
 * FUEL-94's assets were monochrome line art on an explicit white ground, and
 * `dark:invert` was the raster restatement of `currentColor` — black-on-white
 * became white-on-black and the drawing was the same drawing. That works only
 * because inverting a two-tone image is exact. Inverting a PHOTOGRAPH produces a
 * colour negative, so the filter and its `bg-white` companion are gone. These
 * sit on the sheet's own `raised` fill in both modes, which is what a photograph
 * wants and what § Materials now says.
 *
 * ## The clip case, and why it does not autoplay at all
 *
 * FUEL-94 asks for muted, `playsinline`, looping, and no autoplay with sound —
 * "a clip that starts talking in a gym is a bug". Muted autoplay would satisfy
 * that literally; this does something stricter and does not autoplay.
 *
 * § Accessibility honours `prefers-reduced-motion` by dropping the chart and
 * ruler draw-in, and a looping clip that starts on its own is a larger piece of
 * unrequested motion than either. And the reveal is already a deliberate act —
 * you pressed "Show form" — so a control that then needs a second press costs a
 * reader nothing they did not already choose. `preload="none"` does the rest:
 * opening the sheet does not fetch the clip, pressing play does.
 */
function Figure({
  frame,
  kind,
  alt,
}: {
  frame: MediaFrame;
  kind: "image" | "video";
  alt: string;
}) {
  const shared = {
    width: frame.width,
    height: frame.height,
    className: "h-auto w-full",
  };

  return (
    <figure className="flex flex-col gap-2">
      {/* The hairline and radius live on the wrapper so the media can be
          replaced without the frame moving with it. */}
      <div className="overflow-hidden rounded-md border border-border">
        {kind === "video" ? (
          <video
            {...shared}
            src={frame.path}
            aria-label={alt}
            preload="none"
            controls
            muted
            loop
            playsInline
          />
        ) : (
          /*
           * A plain `<img>`, and not `next/image`.
           *
           * `next/image` earns its keep on images whose size is not known until
           * runtime and whose source is not under the author's control; both are
           * false here. Each frame is served from the bundle at a size this
           * file already knows, and § Sheets holds the panel to the 584px
           * measure, so what is left of the component is `loading="lazy"` and a
           * `srcset` — one an attribute, the other variants of a file with no
           * larger source to make them from.
           */
          // eslint-disable-next-line @next/next/no-img-element -- justified above.
          <img {...shared} src={frame.path} alt={alt} loading="lazy" decoding="async" />
        )}
      </div>

      {/*
        Which moment this is. `aria-hidden` because the text is IDENTICAL to the
        media's accessible name directly above it, so announcing both reads the
        same phrase twice for no gain — the caption is a second rendering of one
        label rather than a second fact.
      */}
      <figcaption aria-hidden className="text-slash text-text-tertiary">
        {`/ ${frame.label}`}
      </figcaption>
    </figure>
  );
}
