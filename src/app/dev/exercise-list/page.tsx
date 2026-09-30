import type { Metadata } from "next";

import { ExerciseListSpecimen } from "./specimen";

/**
 * `/training`'s exercise rows with a 16:9 photograph — FUEL-130.
 *
 * ## Why this page exists at all
 *
 * The dead bug's frames are 1280×720, the one asset that is not 850×567, and
 * § The row's photograph draws it 72×41 rather than cropping it to 72×48.
 * `row-photograph.spec.ts` photographed that by finding the dead bug in the
 * demo's frozen week — and FUEL-130 took it out of the week, when kettlebell
 * swings replaced the skipping session and its core finisher went with it.
 *
 * The rule did not go. The asset still ships, and an owner's past skipping
 * sessions still draw it. What went is the only fixture that reached it, so,
 * as `/dev/right-now` and `/dev/route-trace` do, this page carries its own:
 * a 3:2 row and the 16:9 one beneath it, through the real `ExerciseList`.
 */
export const metadata: Metadata = {
  title: "Exercise list",
  robots: { index: false, follow: false },
};

export default function ExerciseListPage() {
  return (
    <main className="mx-auto w-full max-w-[640px] p-6">
      <ExerciseListSpecimen />
    </main>
  );
}
