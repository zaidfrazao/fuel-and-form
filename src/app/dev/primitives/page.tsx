import type { Metadata } from "next";

import { KeyValueGrid } from "@/components/kv-grid";
import { MOTIF_NAMES, Motif } from "@/components/motifs";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tile } from "@/components/tile";

/**
 * The shared primitives — key/value grid, tile, and the eight line motifs.
 * Everything here is a claim about type, spacing and material that jsdom cannot
 * evaluate, so this page is where they are checked against
 * `docs/BRAND_GUIDE.html` and the Testing Strategy's Appearance checklist.
 *
 * Not a product screen. Delete it once the meal picker and meal detail cover the
 * same ground, as with /dev/tokens and /dev/day-ruler.
 */
export const metadata: Metadata = {
  title: "Shared primitives",
  robots: { index: false, follow: false },
};

/**
 * The figures the mock renders. Invented, like every other fixture here — the
 * repository is public and the owner's real plan stays in docs/, per Testing
 * Strategy § 1.5.
 */
const MACROS = [
  { label: "Calories", value: "612" },
  // Protein is emphasised by weight, not colour. Colour is spoken for.
  { label: "Protein", value: "48 g", emphasis: true },
  { label: "Fat", value: "18 g" },
  { label: "Carbs", value: "61 g" },
];

const TODAY = [
  { label: "Today so far", value: "1,178", meta: "of 1,780 kcal" },
  { label: "Protein left", value: "50 g", meta: "98 of 148 g" },
];

const COMPACT = [
  { label: "Weight", value: "84.2" },
  { label: "7-day", value: "−0.4" },
  { label: "Rate", value: "−0.5" },
];

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[14px]">
      <span className="flex flex-col gap-1">
        <h2 className="text-micro text-text-tertiary uppercase">{title}</h2>
        <span className="text-slash text-text-secondary">/ {note}</span>
      </span>
      {children}
    </section>
  );
}

export default function PrimitivesSpecimen() {
  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-[30px] px-[22px] py-10 md:px-7">
      <header className="flex flex-col gap-[14px]">
        {/* Two words, not "Primitives". At 200% Dynamic Type a single
            eleven-character word set at 40px is wider than the 375px screen's
            content box and scrolls the page sideways, against Brand Guide
            § Accessibility. A title that can wrap is the whole fix. */}
        <h1 className="text-title">Shared primitives</h1>
        <p className="text-body text-text-secondary">
          Brand Guide § Component Patterns and § Materials, rendered. Narrow to
          375px, switch modes, tab through the selectable tiles to check the
          focus ring, and zoom to 200% — nothing should scroll sideways.
        </p>
        <ThemeToggle />
      </header>

      <Section
        title="Key/value grid · two columns"
        note="Micro label above, Value below. The space between 22px and 10.5px is deliberately empty."
      >
        <div className="max-w-[331px]">
          <KeyValueGrid items={MACROS} />
        </div>
      </Section>

      <Section
        title="Key/value grid · with slash metadata"
        note="The third line. Secondary facts are prefixed, never parenthesised."
      >
        <div className="max-w-[331px]">
          <KeyValueGrid items={TODAY} />
        </div>
      </Section>

      <Section
        title="Key/value grid · three columns"
        note="Three only when the figures are short. Compact stats, not the default."
      >
        <div className="max-w-[331px]">
          <KeyValueGrid items={COMPACT} columns={3} />
        </div>
      </Section>

      <Section
        title="Tiles"
        note="The mock's meal picker. One ink tile carries the eye; selection is a ring, never a fill."
      >
        {/* Every tile in the group passes `selected` as a boolean, including the
            unselected ones, so all four announce as toggles rather than one
            pressed toggle among three ordinary buttons. */}
        <div className="grid max-w-[331px] grid-cols-2 gap-[10px]">
          <Tile
            as="button"
            material="ink"
            selected
            name={
              <>
                Chicken
                <br />
                &amp; Rice
              </>
            }
            motif="plate"
            meta="591 kcal · P 62"
          />
          <Tile
            as="button"
            selected={false}
            name={
              <>
                Beef Mince
                <br />
                &amp; Potato
              </>
            }
            motif="pot"
            meta="648 kcal · P 51"
          />
          <Tile
            as="button"
            selected={false}
            name={
              <>
                Chilli
                <br />
                con Carne
              </>
            }
            motif="bowl"
            meta="612 kcal · P 48"
          />
          <Tile
            as="button"
            selected={false}
            name={
              <>
                Overnight
                <br />
                Oats
              </>
            }
            motif="roll"
            meta="430 kcal · P 28"
          />
        </div>
      </Section>

      <Section
        title="Tiles · selection on stone"
        note="The accent ring has to read on both materials, in both modes."
      >
        <div className="grid max-w-[331px] grid-cols-2 gap-[10px]">
          <Tile as="button" selected name="Selected" motif="egg" meta="Stone" />
          <Tile
            as="button"
            material="ink"
            selected={false}
            name="Unselected"
            motif="bar"
            meta="Ink"
          />
        </div>
      </Section>

      <Section
        title="Tile · not interactive"
        note="Meal detail shows the tile without offering a choice, so it is a div and takes no focus."
      >
        <div className="grid max-w-[160px] grid-cols-1">
          <Tile name="Dinner" motif="plate" meta="19:00 · serves 1" />
        </div>
      </Section>

      <Section
        title="The eight motifs"
        note="1.6px stroke in currentColor, on canvas. Compare against the sprite in BRAND_GUIDE.html."
      >
        <ul className="flex flex-wrap gap-5">
          {MOTIF_NAMES.map((name) => (
            <li key={name} className="flex flex-col items-center gap-2">
              <Motif name={name} className="h-[46px] w-[46px]" />
              <span className="text-micro text-text-tertiary uppercase">
                {name}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="The eight motifs · on ink and stone"
        note="currentColor is what makes one set enough. Neither row should need its own artwork."
      >
        <div className="flex flex-col gap-[10px]">
          <ul className="flex flex-wrap gap-5 rounded-lg bg-ink px-4 py-5 text-ink-fg">
            {MOTIF_NAMES.map((name) => (
              <li key={name}>
                <Motif name={name} className="h-[46px] w-[46px]" />
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-5 rounded-lg bg-surface px-4 py-5 text-text-primary">
            {MOTIF_NAMES.map((name) => (
              <li key={name}>
                <Motif name={name} className="h-[46px] w-[46px]" />
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </main>
  );
}
