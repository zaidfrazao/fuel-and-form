"use client";

import { Sheet } from "@/components/ui/sheet";
import type { ResolvedFormMedia } from "@/lib/form-media";

/**
 * Form reference media, revealed — § P10, FUEL-94.
 *
 * What the session state's "Show form" button opens. One exercise, one piece of
 * media, its description and its attribution.
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
 * states no width of its own.
 *
 * ## The description is rendered, not just announced
 *
 * § Accessibility gives the signature graphics "an accessible summary plus an
 * adjacent data table", on the reasoning that "a mark on a screen is not the
 * data". Media is the same case and more so: the picture IS the content of this
 * sheet, so the words for it are content too, and putting them only in `alt`
 * would mean a sighted reader who cannot interpret the image — which is most
 * people, for most exercises, which is why the sheet exists — gets nothing the
 * screen reader user gets. It is therefore visible text AND the alt, one string
 * for both jobs, on `ui/sheet.tsx`'s own reasoning about its title.
 *
 * ## Attribution is a licence condition, not a courtesy
 *
 * Where `credit` is non-null the licence requires it, and it renders with a link
 * to the licence text. That is the app's side of the bargain that lets a public
 * repository ship somebody else's work at all.
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
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Form · ${exerciseName}`}
    >
      <div className="flex flex-col gap-5">
        {/* The frame the media sits in. It holds the hairline and the radius so
            that `dark:invert` on the media itself does not flip them. */}
        <div className="overflow-hidden rounded-md border border-border">
          <FormMedia media={media} />
        </div>

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
 * The media element itself — the one place a kind is turned into a tag.
 *
 * `media.path` comes from `FORM_MEDIA`, which is a compile-time constant. No
 * stored value reaches this function; see `lib/form-media.ts` on why that is the
 * whole shape of the feature rather than a detail of it.
 *
 * ## The clip case, and why it does not autoplay at all
 *
 * FUEL-94 asks for muted, `playsinline`, looping, and no autoplay with sound —
 * "a clip that starts talking in a gym is a bug". Muted autoplay would satisfy
 * that literally, and this does something stricter: it does not autoplay.
 *
 * Two reasons. § Accessibility honours `prefers-reduced-motion` by dropping the
 * chart and ruler draw-in, and a looping clip that starts on its own is a larger
 * piece of unrequested motion than either; gating autoplay on that query would
 * mean writing the query, and the simpler answer is available. And the reveal is
 * already a deliberate act — you pressed "Show form" — so a control that then
 * needs a second press costs a reader nothing they did not already choose.
 *
 * `preload="none"` is the ticket's, and it does the work the ticket wants from
 * it: opening the sheet does not fetch the clip, pressing play does.
 */
function FormMedia({ media }: { media: ResolvedFormMedia }) {
  const shared = {
    width: media.width,
    height: media.height,
    /*
     * `bg-white dark:invert` — the raster answer to `currentColor`.
     *
     * The motifs work in both modes because they are inline SVG and inherit the
     * ink. These cannot: an `<img>` is an opaque boundary, so a file's black
     * strokes stay black on a ground that has gone dark, and this app's theme is
     * a MANUAL toggle, which rules out a `prefers-color-scheme` block inside the
     * file — the OS and the app disagree whenever the reader has chosen.
     *
     * These assets are monochrome line art, so inverting them is exact rather
     * than approximate: black-on-white becomes white-on-black, and the drawing
     * is the same drawing. `bg-white` is what makes it uniform across the set —
     * three of the four are transparent SVGs and one is an opaque white PNG, and
     * without an explicit ground the transparent ones would inherit the canvas
     * and inverting would leave them black-on-black.
     *
     * The border is on the wrapper rather than here, or it would invert too and
     * a hairline in `border` would come back as its opposite.
     *
     * This applies at display time and modifies nothing; `lib/form-media.ts`
     * records why that distinction matters to a share-alike licence.
     */
    className: "h-auto w-full bg-white dark:invert",
  };

  if (media.kind === "video") {
    return (
      <video
        {...shared}
        src={media.path}
        aria-label={media.alt}
        preload="none"
        controls
        muted
        loop
        playsInline
      />
    );
  }

  return (
    /*
     * A plain `<img>`, and not `next/image`.
     *
     * This is the app's first raster image, so the choice is being made rather
     * than followed. `next/image` earns its keep on images whose size is not
     * known until runtime and whose source is not under the author's control;
     * both are false here. The asset is pre-encoded to the one width this sheet
     * can draw it at — § Sheets holds the panel to the 584px measure — its
     * intrinsic size is a compile-time constant, and it is served from the
     * bundle. What is left of the component is `loading="lazy"` and a `srcset`,
     * one of which is an attribute and the other of which would ask the
     * optimiser to make variants of a file that has no larger source to make
     * them from.
     *
     * It also keeps the ticket's Lighthouse criterion honest: the optimiser
     * would improve the score by doing work on a deployment that this measures
     * nothing about locally.
     */
    // eslint-disable-next-line @next/next/no-img-element -- justified above.
    <img
      {...shared}
      src={media.path}
      alt={media.alt}
      loading="lazy"
      decoding="async"
    />
  );
}
