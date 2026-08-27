import type { Metadata } from "next";

import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The token specimen. Every colour, every type level, and the contrast pairs
 * the Brand Guide measures, on one screen in both modes — the surface the
 * Testing Strategy's manual "Appearance" checklist is run against.
 *
 * Not a product screen. It exists because a token layer is otherwise invisible
 * until something is built on it, and it should be deleted once the real
 * screens can serve the same purpose.
 */
export const metadata: Metadata = {
  title: "Design tokens",
  robots: { index: false, follow: false },
};

const PALETTE = [
  { token: "accent", swatch: "bg-accent", usage: '"Now" only' },
  {
    token: "accent-subtle",
    swatch: "bg-accent-subtle",
    usage: "Swapped cells and the Swapped tag",
  },
  { token: "ink", swatch: "bg-ink", usage: "Primary buttons, active tab" },
  { token: "ink-fg", swatch: "bg-ink-fg", usage: "Text on an ink fill" },
  { token: "canvas", swatch: "bg-canvas", usage: "Where nearly everything sits" },
  { token: "surface", swatch: "bg-surface", usage: "Stone tiles only" },
  { token: "raised", swatch: "bg-raised", usage: "Sheets" },
  { token: "border", swatch: "bg-border", usage: "Hairlines, separators, hatch" },
  {
    token: "text-primary",
    swatch: "bg-text-primary",
    usage: "Titles, values, meal names",
  },
  {
    token: "text-secondary",
    swatch: "bg-text-secondary",
    usage: "Micro labels, slash metadata",
  },
  {
    token: "text-tertiary",
    swatch: "bg-text-tertiary",
    usage: "Ticks, dots, placeholders",
  },
  { token: "success", swatch: "bg-success", usage: "On-target deltas" },
  { token: "error", swatch: "bg-error", usage: "Material overage" },
];

const TYPE = [
  { level: "Display", className: "text-display", sample: "76" },
  { level: "Title", className: "text-title", sample: "Chilli con Carne" },
  { level: "Value", className: "text-value", sample: "1,480 kcal" },
  { level: "Body", className: "text-body", sample: "Dinner at 19:00, serves 1" },
  { level: "Slash", className: "text-slash", sample: "/ 612 kcal · 25 min" },
  { level: "Micro", className: "text-micro uppercase", sample: "Protein today" },
];

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[14px]">
      <h2 className="text-micro uppercase text-text-secondary">{label}</h2>
      {children}
    </section>
  );
}

export default function DesignTokens() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex max-w-[640px] flex-col gap-[30px] px-[22px] py-10 md:px-7">
      <header className="flex flex-col gap-[14px]">
        <h1 className="text-title">Design tokens</h1>
        <p className="text-body text-text-secondary">
          Brand Guide § Color Palette and § Typography, rendered. Switch modes
          and compare against the guide.
        </p>
        <ThemeToggle />
      </header>

      <Section label="Palette">
        <ul className="flex flex-col">
          {PALETTE.map(({ token, swatch, usage }) => (
            <li
              key={token}
              className="flex items-center gap-[14px] border-b border-border py-3 last:border-b-0"
            >
              <span
                aria-hidden
                className={`size-11 shrink-0 rounded-lg ring-1 ring-border ${swatch}`}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-body">{token}</span>
                <span className="text-slash text-text-tertiary">/ {usage}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section label="Contrast pairs">
        <div className="flex flex-col gap-2">
          <p className="rounded-lg bg-accent-subtle px-4 py-3 text-body text-accent">
            accent on accent-subtle / 4.9:1 light · 6.7:1 dark
          </p>
          <p className="rounded-lg bg-ink px-4 py-3 text-body text-ink-fg">
            ink-fg on ink / the primary button
          </p>
          <p className="rounded-lg bg-surface px-4 py-3 text-body text-text-primary">
            text-primary on surface / stone tiles
          </p>
          <p className="text-body text-text-secondary">
            text-secondary on canvas / 4.8:1 light · 7.9:1 dark
          </p>
          <p className="text-body text-text-tertiary">
            text-tertiary on canvas / never for information the user must read
          </p>
        </div>
      </Section>

      <Section label="Type scale">
        <ul className="flex flex-col gap-[22px]">
          {TYPE.map(({ level, className, sample }) => (
            <li key={level} className="flex flex-col gap-1">
              <span className="text-micro uppercase text-text-tertiary">
                {level}
              </span>
              <span className={className}>{sample}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Invented figures. The repository is public and the owner's real
          targets are confined to docs/ — see Testing Strategy § 1.5. */}
      <Section label="Numerals">
        <div className="grid grid-cols-2 gap-x-4 gap-y-[22px]">
          <p className="text-value">1,480 / 1,500</p>
          <p className="text-value">112 / 120</p>
          <p className="text-value text-success">−0.30 kg/wk</p>
          <p className="text-value text-error">+220 kcal</p>
        </div>
        <p className="text-slash text-text-tertiary">
          / tabular-nums is inherited from body — the columns above align digit
          for digit. success is a goal-pace rate, error a material overage;
          neither marks a skip
        </p>
      </Section>
    </main>
  );
}
