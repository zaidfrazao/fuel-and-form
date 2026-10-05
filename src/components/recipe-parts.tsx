import { Fragment, type ReactNode } from "react";

import type { Block, Inline, Method } from "@/lib/recipe";
import { cn } from "@/lib/utils";

/**
 * The recipe screen's drawing parts — FUEL-143, moved out of `recipe-view.tsx`
 * by FUEL-144.
 *
 * No `"use client"` and no hooks, so both halves of the screen render them:
 * the server's `RecipeView` for the tile and the notes, and `RecipePrep`, the
 * client island that holds the two tick lists.
 */

/**
 * A micro label over its content — 14px between, § Spacing & Layout.
 *
 * `count` is a prep list's `n of m` (FUEL-144), at the label's right. Outside
 * the `<h2>`, so the heading is still named "Ingredients" and not
 * "Ingredients 3 of 16", and not a live region: the checkbox already announces
 * its own change, as on `/shopping`.
 */
export function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: { done: number; of: number };
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[14px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-micro uppercase text-text-secondary">{label}</h2>
        {count && (
          <p className="text-slash tabular-nums text-text-secondary">
            {count.done} of {count.of}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-body text-text-secondary">{children}</p>;
}

/** Bold and italic, and nothing else — `lib/recipe.ts`'s ceiling. */
export function Runs({ inline }: { inline: readonly Inline[] }) {
  return inline.map((run, i) => {
    if (run.strong) return <strong key={i} className="font-semibold">{run.text}</strong>;
    if (run.em) return <em key={i}>{run.text}</em>;
    return <Fragment key={i}>{run.text}</Fragment>;
  });
}

export function Blocks({
  blocks,
  tone = "primary",
}: {
  blocks: readonly Block[];
  tone?: "primary" | "secondary";
}) {
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <h3 key={i} className="text-micro uppercase text-text-secondary">
                {block.text}
              </h3>
            );

          case "paragraph":
            return (
              <p
                key={i}
                className={cn(
                  "text-body",
                  tone === "primary" ? "text-text-primary" : "text-text-secondary",
                )}
              >
                <Runs inline={block.inline} />
              </p>
            );

          case "table":
            return (
              <table key={i} className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    {block.head.map((cell, c) => (
                      <th
                        key={c}
                        scope="col"
                        className="pb-1 pr-3 text-micro font-normal uppercase text-text-secondary last:pr-0"
                      >
                        <Runs inline={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r} className="border-t border-border">
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          className="py-[11.5px] pr-3 align-top text-body text-text-primary last:pr-0"
                        >
                          <Runs inline={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
        }
      })}
    </div>
  );
}

/**
 * A method as the recipe screen numbers it, without the ticks — FUEL-147's
 * edit preview.
 *
 * Takes `parseMethod`'s output rather than text, so the sheet and the screen
 * cannot read one method two ways: both call the same parser, and this draws
 * its steps in `RecipePrep`'s numbered column — `w-[2ch]`, tabular,
 * `text-secondary` — with the box gone, because a preview is not cooked from.
 */
export function MethodSteps({ method }: { method: Method | null }) {
  if (!method) return <Quiet>No method recorded.</Quiet>;

  return (
    <div className="flex flex-col gap-5">
      {method.before.length > 0 && <Blocks blocks={method.before} />}

      <ol className="flex flex-col gap-3">
        {method.steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-body">
            <span aria-hidden className="w-[2ch] shrink-0 text-right tabular-nums text-text-secondary">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 text-text-primary">
              <Runs inline={step} />
            </span>
          </li>
        ))}
      </ol>

      {method.after.length > 0 && <Blocks blocks={method.after} tone="secondary" />}
    </div>
  );
}
