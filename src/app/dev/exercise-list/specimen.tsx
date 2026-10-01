"use client";

import { ExerciseList, type RowThumbnail } from "@/components/exercise-list";
import { FORM_MEDIA } from "@/lib/form-media";
import { WORKING_SECTION } from "@/lib/section";

/**
 * The plan-state list with a 16:9 photograph on a row — FUEL-130.
 *
 * Client-side only because `ExerciseList`'s affordance takes a callback, and a
 * server page cannot hand one across. The callback does nothing: this page
 * photographs the row, it does not open its sheet.
 */

const EXERCISES = [
  {
    id: "plank",
    name: "Plank",
    prescription: "3 x 30–45 sec",
    notes: null,
    section: WORKING_SECTION,
  },
  {
    id: "dead-bug",
    name: "Dead bug",
    prescription: "3 x 10 each side",
    notes:
      "On your back, opposite arm and leg extend slowly. The lower back stays pressed to the floor throughout.",
    section: WORKING_SECTION,
  },
];

// The working frame, as `training.tsx` takes it: the asset's last.
const THUMBNAILS = new Map<string, RowThumbnail>([
  ["plank", FORM_MEDIA.plank.frames[1]],
  ["dead-bug", FORM_MEDIA["dead-bug"].frames[1]],
]);

export function ExerciseListSpecimen() {
  return (
    <ExerciseList
      exercises={EXERCISES}
      affordance={{
        available: new Map([
          ["plank", "form"],
          ["dead-bug", "form"],
        ]),
        thumbnails: THUMBNAILS,
        onShow: () => {},
      }}
    />
  );
}
