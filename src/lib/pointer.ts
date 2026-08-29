/**
 * Pointer states — Brand Guide § Desktop, "Pointer states".
 *
 * One place the app says what a control does under a mouse, because the reason
 * the guide gained this section is that there was no such place: eight `hover:`
 * declarations had accumulated across five files, each a local decision nobody
 * could check against anything, and the navigation rail — the first control a
 * pointer is the only way to use — answered a mouse with nothing at all.
 *
 * ## Two grounds and one ring, chosen by what a control rests as
 *
 * § Desktop keys the rule to the drawing rather than to the component, "so that
 * a control invented later already has its hover without this table being
 * reopened":
 *
 * | Rests as | On hover |
 * |---|---|
 * | Nothing, an outline, or a ghost | gains `surface` |
 * | A solid fill | that fill at 90% over the canvas |
 * | A `surface` fill | a 1.5px inset rule in `text-3` |
 *
 * The values are not new. `hover:bg-surface` and `hover:bg-ink/90` are what the
 * app's eight existing declarations already reached for, and § Desktop says so
 * — "this ratifies a convention rather than replacing one". What was missing
 * was anything saying they applied to the rail.
 *
 * ## `@media (hover: hover)` comes free, and that is worth stating
 *
 * The guide requires the states to be scoped to devices that have a pointer,
 * "because a phone brought in on width alone would answer a tap by leaving the
 * hover state stuck to the control afterwards". **Tailwind v4 wraps every
 * `hover:` and `group-hover:` utility in `@media (hover: hover)` by default**,
 * so every constant below is already scoped and none of them says so.
 *
 * That is a fact about the installed major version rather than about Tailwind,
 * and it is the whole of the guide's requirement, so it is written down here:
 * v3 gated `hover:` on nothing, and an upgrade backwards would silently unstick
 * every state in this file. `pointer.test.ts` compiles one of them and asserts
 * the media query, so the day that changes is a failing test rather than a bug
 * reported from a phone.
 *
 * ## Hover is not focus
 *
 * No hover state below replaces a focus ring or is written into one.
 * § Accessibility fixes the ring at 2px `accent` with 2px offset and "never
 * removed", and § Desktop is explicit that the two may not be folded together:
 * "a pointer user gets one of these two states and a keyboard user the other".
 * Every control that already had a `focus-visible:` ring keeps exactly the one
 * it had; `FOCUS_RING` at the foot of this file is for the dozen links that
 * never had one, and it is a separate constant so that neither can be reached
 * by editing the other.
 */

/**
 * The first row of the table: a control that rests as nothing, an outline, or a
 * ghost gains the `surface` ground.
 *
 * Secondary, Text and Destructive buttons, list rows, checkboxes, week cells
 * and inactive rail items.
 */
export const HOVER_GROUND = "hover:bg-surface";

/**
 * The second row: a control that rests as a solid `ink` fill goes to that fill
 * at 90%.
 *
 * Primary buttons, ink tiles, and the active rail item. Tailwind compiles the
 * `/90` to a `color-mix` against `transparent` — alpha rather than the mock's
 * opaque mix with `--canvas` — which composites to the same colour wherever
 * these sit, because all three of them sit on the canvas.
 *
 * § Desktop says "that fill" rather than "`ink`" because Destructive has two
 * rest states; the filled one is `hover:bg-destructive/90`, written at its one
 * call site in `weigh-ins.tsx` rather than here, since it is the variant's
 * exception rather than its rule.
 */
export const HOVER_FILL = "hover:bg-ink/90";

/**
 * The third row: a control already resting on the hover ground takes a 1.5px
 * inset rule in `text-3` instead of a fill.
 *
 * Stone tiles, and the swapped week cell — see `HOVER_RING`'s second caller in
 * `week-grid.tsx` for why a tinted ground takes the ring rather than the fill.
 *
 * § Desktop records this against § Deliberately Absent's ban on elevation: it
 * is "a hairline painted where a second border would go — inside the element's
 * own edge, casting nothing, occupying no space and lifting the tile off
 * nothing", which is neither depth nor a material.
 *
 * Written as an arbitrary value with every space escaped as an underscore,
 * which is what `tile.tsx` and `day-ruler.tsx` write and why. Their stated
 * reason no longer holds on its own terms — those comments say an unescaped
 * space "fails *silently*", and Tailwind v4.3.3 in fact accepts the space and
 * escapes it into the selector; `pointer.test.ts` compiles both forms and
 * records it. The underscore stays as the house style. What does still hold is
 * the shape of the risk: a utility Tailwind declines to generate is a missing
 * ring rather than a build error, so this string is compiled and asserted
 * rather than read.
 */
export const HOVER_RING =
  "hover:shadow-[inset_0_0_0_1.5px_var(--text-tertiary)]";

/**
 * A link's hover, which is a colour rather than a ground.
 *
 * The one place `BRAND_GUIDE.md`'s table and `BRAND_GUIDE.html` disagree: the
 * table lists links under "gains `surface`", and the mock draws
 * `.lnk:hover { color: var(--text); text-decoration-color: currentColor }` —
 * the text darkening to `text-primary` and the underline coming up with it.
 * § Document History makes the mock authoritative for appearance, and FUEL-75's
 * own brief says not to invent states here, so the drawing wins.
 *
 * It is also the reading that holds § Accessibility. Every link in this app
 * rests in `text-secondary` or `text-tertiary`, and `text-secondary` measures
 * 4.80:1 on the canvas against a 4.5:1 requirement — 0.30 of headroom. A
 * `surface` ground under it reads 4.26:1 and fails. Darkening the text instead
 * takes it to 15.52:1. See `pointer.contrast.test.ts`, which measures every
 * pair rather than asserting the classes.
 */
export const HOVER_LINK = "hover:text-text-primary hover:decoration-current";

/**
 * The lift, for text that would otherwise be read against a darker ground.
 *
 * Goes on `text-secondary` and `text-tertiary` content *inside* a control that
 * takes `HOVER_GROUND`, whose own element carries `group`. Two reasons it is a
 * `group-hover:` on the child rather than a `hover:text-*` on the parent:
 * colour inherits, but a child that names its own colour class wins over an
 * inherited one, so the parent form would silently do nothing to exactly the
 * spans that need it.
 *
 * ## Why the lift exists at all
 *
 * § Accessibility requires ≥4.5:1 for small text, and `text-secondary` measures
 * 4.80:1 on the canvas and **4.26:1 on `surface`**. So a list row that gains
 * the hover ground drops its own metadata below AA — the week cell's kcal, the
 * template row's slot label, the recent-sessions status, the shopping row's
 * amount. `text-tertiary` starts below the line and goes further under it.
 *
 * The mock has the same shortfall: it draws `.row-trail` in `--text-2` on
 * `--hover-ground`, which is the same 4.26:1. So this is inherited rather than
 * introduced, and it cannot be fixed by ignoring it — § Accessibility's own
 * tie-break is "where restraint and contrast conflict, contrast wins".
 *
 * The device is the mock's own. `.railitem:not(.active):hover` and `.lnk:hover`
 * both raise their colour to `var(--text)` on hover; this applies that same
 * move one row wider, to the metadata inside a control rather than only to the
 * control's own label. Extending a drawn state beat inventing an undrawn one,
 * and it beat darkening the `--text-secondary` token, which would have moved
 * text on all seven screens and rewritten all 56 baselines — losing the
 * byte-identical control that proves this change touches nothing at rest.
 */
export const HOVER_LIFT = "group-hover:text-text-primary";

/**
 * `cursor: pointer`, on every control that is not an `<a href>`.
 *
 * § Desktop states it flatly "because the obvious assumption is wrong: browsers
 * give `<button>` `cursor: default`, not `pointer`, and Tailwind v4's preflight
 * does not add one — v3's did, and v4 dropped it, so an app carried across the
 * versions loses the pointer on every button silently."
 *
 * That is this app. Before FUEL-75 there was exactly one `cursor-pointer` in
 * `src/`, on a `<label>` in `shopping-list-view.tsx`, and every button in the
 * app drew an arrow. It is the smallest rule in the section and the one most
 * often missed, "because it is invisible to the keyboard a developer tests
 * with" — and invisible to a screenshot, which is why `pointer.test.ts` asserts
 * it on the component rather than the visual suite catching it.
 *
 * `<a href>` carries it natively and § Desktop leaves it alone, so the link
 * sites in this sweep get `HOVER_LINK` and nothing else.
 */
export const POINTER = "cursor-pointer";

/**
 * § Accessibility's focus ring — 2px `accent` at 2px offset, "on every
 * interactive element in both modes. Never removed."
 *
 * Not a pointer state, and it is in this file for the reason § Desktop gives
 * for refusing to fold the two together: "a control drawn with only the hover
 * leaves the keyboard with nothing, and one drawn with only the focus ring
 * answers a mouse with a claim about a caret. Both are specified, on every
 * control class, for that reason."
 *
 * FUEL-75 is what makes that binding. Roughly a dozen links in this app had
 * neither state and so were consistently half-specified; `up-link.tsx` records
 * the gap by name — "still outstanding, and not this component's to fix:
 * `week-nav.tsx`'s prev/next and the 'Back to this week' resets are in the same
 * position." Giving those links a hover without a ring would have left the
 * keyboard behind at the moment the mouse was served, so the sweep carries the
 * ring to every control it gives a hover to.
 *
 * The string is `nav-shell.tsx`'s and `up-link.tsx`'s, character for character;
 * those two are left as they were rather than rewritten to import it, so this
 * constant records a convention it did not invent. `ring` is `accent`, per
 * `globals.css`.
 */
export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
