"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { editRecipe, type RecipeEditState } from "@/app/actions/recipe";
import { MethodSteps } from "@/components/recipe-parts";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { FOCUS_RING, HOVER_LINK, POINTER } from "@/lib/pointer";
import { parseMethod } from "@/lib/recipe";
import {
  blankIngredient,
  type IngredientDraft,
  MAX_INGREDIENTS,
  MEAL_FIELD,
  RECIPE_FIELD,
  type RecipeDraft,
} from "@/lib/recipe-edit";
import { SHOPPING_CATEGORIES } from "@/lib/shopping-list";
import { cn } from "@/lib/utils";

/**
 * Editing a recipe — FUEL-147, Brand Guide § Recipe, *Editing, for the owner
 * only*.
 *
 * The `Edit` control on the up-link's row, and the sheet it opens. Rendered by
 * `RecipeView` only when it is handed a draft, and the page hands one only to
 * the owner — so a demo session has no control at all. That is the courtesy;
 * `actions/recipe.ts` refusing a demo session is the rule.
 *
 * ## A sheet, not a route
 *
 * `/recipe/[mealId]` is level 2, and § Navigation sends anything deeper to a
 * sheet. The sheet stands in the measure as every sheet does, and its Save is
 * pinned in the footer for the swap sheet's reason (FUEL-135): a recipe with
 * sixteen ingredients would otherwise put it a thousand pixels down.
 *
 * ## The draft is the client's until Save
 *
 * Held in state as text, submitted as one JSON field and judged by
 * `parseRecipeEdit` behind the action. Nothing is written until Save, and a
 * dismissed sheet discards the draft: each opening mounts a fresh `EditSheet`
 * (`key` below) that starts from the stored recipe the page passed in.
 */
export function RecipeEditor({
  mealId,
  slot,
  draft,
}: {
  mealId: string;
  /** The slot's label, for the sheet's meta — `Dinner`. */
  slot: string;
  draft: RecipeDraft;
}) {
  const [open, setOpen] = useState(false);

  // A fresh sheet per opening. Keyed rather than reset on close, because Radix
  // keeps the portal through the close transition and a reset would be seen.
  const [opening, setOpening] = useState(0);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpening((n) => n + 1);
          setOpen(true);
        }}
        /*
         * The up-link's type and underline, so the row reads "‹ Plan … Edit".
         * 44px of hit area from padding, cancelled by an equal negative margin
         * so the row is the up-link's height still — 16px of micro plus 14
         * either side.
         */
        className={cn(
          "-my-[14px] py-[14px] text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4",
          FOCUS_RING,
          HOVER_LINK,
          POINTER,
        )}
      >
        Edit
      </button>

      <EditSheet
        key={opening}
        open={open}
        onOpenChange={setOpen}
        mealId={mealId}
        slot={slot}
        initial={draft}
      />
    </>
  );
}

/** An ingredient in the sheet, with a key that survives being moved. */
type Row = { key: string; draft: IngredientDraft };

/** Where focus goes after a list change: a row's field or button, or Add. */
type FocusTarget = { key: string; part: "name" | "up" | "down" } | "add" | null;

const FIELD = cn(
  "h-11 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-body text-text-primary aria-invalid:border-destructive",
  FOCUS_RING,
);

const TEXTAREA = cn(
  "min-h-40 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-body text-text-primary aria-invalid:border-destructive",
  FOCUS_RING,
);

const TEXT_BUTTON = cn(
  "min-h-11 text-body text-text-secondary underline decoration-text-tertiary underline-offset-4 disabled:pointer-events-none disabled:opacity-50",
  FOCUS_RING,
  HOVER_LINK,
  POINTER,
);

const FORM_ID = "recipe-edit";

function EditSheet({
  open,
  onOpenChange,
  mealId,
  slot,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mealId: string;
  slot: string;
  initial: RecipeDraft;
}) {
  const [state, action, pending] = useActionState<RecipeEditState, FormData>(
    editRecipe,
    undefined,
  );

  const { ingredients, ...rest } = initial;
  const [fields, setFields] = useState(rest);

  const nextKey = useRef(ingredients.length);
  const [rows, setRows] = useState<Row[]>(() =>
    ingredients.map((draft, i) => ({ key: `row-${i}`, draft })),
  );

  const form = useRef<HTMLFormElement>(null);
  const [focus, setFocus] = useState<FocusTarget>(null);

  // A save closes the sheet; the screen beneath is already the edited recipe,
  // because the action refreshed it. Each save is a new state object, so this
  // runs once per save and not on every render after one.
  useEffect(() => {
    if (state?.status === "saved") onOpenChange(false);
  }, [state, onOpenChange]);

  /*
   * Focus after a list change. A moved row's button is focused again — the
   * DOM node moved, and a browser may drop focus with it — and a button that
   * became disabled by the move (the first row's Move up) hands focus to its
   * neighbour rather than to `<body>`.
   */
  useEffect(() => {
    if (focus === null || !form.current) return;

    const find = (selector: string) =>
      form.current?.querySelector<HTMLElement>(`[data-focus="${selector}"]`);

    const target =
      focus === "add"
        ? find("add")
        : find(`${focus.key}:${focus.part}`);

    if (target && !(target as HTMLButtonElement).disabled) target.focus();
    else if (focus !== "add") find(`${focus.key}:${focus.part === "up" ? "down" : "up"}`)?.focus();

    setFocus(null);
  }, [focus]);

  const errors = state?.status === "invalid" ? state.errors : {};
  const set = (name: keyof typeof fields, value: string) =>
    setFields((current) => ({ ...current, [name]: value }));

  const setRow = (key: string, patch: Partial<IngredientDraft>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, draft: { ...row.draft, ...patch } } : row)),
    );

  function move(index: number, by: -1 | 1) {
    const row = rows[index];
    if (!row) return;

    const next = [...rows];
    next.splice(index, 1);
    next.splice(index + by, 0, row);
    setRows(next);
    setFocus({ key: row.key, part: by < 0 ? "up" : "down" });
  }

  function remove(index: number) {
    const next = rows.filter((_, i) => i !== index);
    setRows(next);

    // The row that took its place, or the one above, or Add when none is left.
    const neighbour = next[index] ?? next[index - 1];
    setFocus(neighbour ? { key: neighbour.key, part: "name" } : "add");
  }

  function add() {
    const key = `row-${nextKey.current++}`;
    setRows((current) => [...current, { key, draft: blankIngredient() }]);
    setFocus({ key, part: "name" });
  }

  const draft: RecipeDraft = { ...fields, ingredients: rows.map((row) => row.draft) };
  const method = parseMethod(fields.method);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit recipe"
      meta={slot}
      footer={
        <>
          <Button type="submit" form={FORM_ID} className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Save recipe"}
          </Button>

          <p aria-live="polite" className="min-h-5 text-slash text-text-secondary">
            {state?.status === "invalid"
              ? (errors.form ?? errors.ingredients ?? "Nothing was saved — check the fields above.")
              : null}
            {state?.status === "refused" ? "This recipe can't be edited." : null}
            {state?.status === "failed" ? "Could not save. Try again." : null}
          </p>
        </>
      }
    >
      <form ref={form} id={FORM_ID} action={action} className="flex flex-col gap-7">
        <input type="hidden" name={MEAL_FIELD} value={mealId} />
        <input type="hidden" name={RECIPE_FIELD} value={JSON.stringify(draft)} />

        <Field label="Name" error={errors.name}>
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="off"
              value={fields.name}
              onChange={(event) => set("name", event.target.value)}
              className={FIELD}
            />
          )}
        </Field>

        <Group heading="Per serving">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {(
              [
                ["kcal", "Calories", "kcal", "numeric"],
                ["proteinG", "Protein", "g", "decimal"],
                ["fatG", "Fat", "g", "decimal"],
                ["carbG", "Carbs", "g", "decimal"],
              ] as const
            ).map(([name, label, unit, inputMode]) => (
              <Field key={name} label={label} unit={unit} error={errors[name]}>
                {(props) => (
                  <input
                    {...props}
                    // Text, not `type="number"`: `targets-form.tsx`'s reason.
                    type="text"
                    inputMode={inputMode}
                    autoComplete="off"
                    value={fields[name]}
                    onChange={(event) => set(name, event.target.value)}
                    className={cn(FIELD, "text-right tabular-nums")}
                  />
                )}
              </Field>
            ))}
          </div>
        </Group>

        <Group heading="Ingredients">
          {rows.length > 0 ? (
            <ol className="flex flex-col">
              {rows.map((row, i) => (
                <li key={row.key} className="border-t border-border py-4 first:border-t-0 first:pt-0">
                  <IngredientFields
                    row={row}
                    index={i}
                    last={i === rows.length - 1}
                    errors={errors}
                    onChange={(patch) => setRow(row.key, patch)}
                    onMove={(by) => move(i, by)}
                    onRemove={() => remove(i)}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-body text-text-secondary">No ingredients recorded.</p>
          )}

          <div className="flex">
            <button
              type="button"
              data-focus="add"
              onClick={add}
              disabled={rows.length >= MAX_INGREDIENTS}
              className={TEXT_BUTTON}
            >
              Add ingredient
            </button>
          </div>
        </Group>

        <Group heading="Method">
          {/* No sentence explaining the step rule: the preview beneath is how
              it is learnt — § Recipe, *Editing*. */}
          <Field label="Method" error={errors.method} hideLabel>
            {(props) => (
              <textarea
                {...props}
                value={fields.method}
                onChange={(event) => set("method", event.target.value)}
                className={TEXTAREA}
              />
            )}
          </Field>

          {/* What the recipe will number. Not live: it moves on every
              keystroke, and the textarea is what is being typed into. */}
          <section aria-label="Method preview" className="flex flex-col gap-[14px]">
            <h3 className="text-micro uppercase text-text-secondary">Preview</h3>
            <MethodSteps method={method} />
          </section>
        </Group>

        <Group heading="Notes">
          <Field label="Notes" error={errors.notes} hideLabel>
            {(props) => (
              <textarea
                {...props}
                value={fields.notes}
                onChange={(event) => set("notes", event.target.value)}
                className={cn(TEXTAREA, "min-h-24")}
              />
            )}
          </Field>
        </Group>
      </form>
    </Sheet>
  );
}

function IngredientFields({
  row,
  index,
  last,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  row: Row;
  index: number;
  last: boolean;
  errors: Record<string, string>;
  onChange: (patch: Partial<IngredientDraft>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { draft, key } = row;
  const at = `ingredients.${index}`;

  // What the row's buttons name — the ingredient, or its place while unnamed.
  const called = draft.name.trim() || `ingredient ${index + 1}`;

  const text = (
    name: "name" | "nonScaleMeasure" | "grams" | "shopName" | "shopQty" | "shopUnit",
    label: string,
    options: { unit?: string; inputMode?: "decimal"; className?: string } = {},
  ) => (
    <Field label={label} unit={options.unit} error={errors[`${at}.${name}`]} className={options.className}>
      {(props) => (
        <input
          {...props}
          data-focus={name === "name" ? `${key}:name` : undefined}
          type="text"
          inputMode={options.inputMode}
          autoComplete="off"
          value={draft[name]}
          onChange={(event) => onChange({ [name]: event.target.value })}
          className={cn(FIELD, options.inputMode && "text-right tabular-nums")}
        />
      )}
    </Field>
  );

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="sr-only">Ingredient {index + 1}</legend>

      {text("name", "Name")}

      <div className="grid grid-cols-[1fr_6rem] gap-3">
        {text("nonScaleMeasure", "Measure")}
        {text("grams", "Weight", { unit: "g", inputMode: "decimal" })}
      </div>

      <div className="grid grid-cols-[1fr_5rem_5rem] gap-3">
        {text("shopName", "Shop as")}
        {text("shopQty", "Count", { inputMode: "decimal" })}
        {text("shopUnit", "Unit")}
      </div>

      <div className="flex items-end gap-4">
        <Field label="Aisle" error={errors[`${at}.category`]} className="flex-1">
          {(props) => (
            <select
              {...props}
              value={draft.category}
              onChange={(event) => onChange({ category: event.target.value })}
              className={cn(FIELD, POINTER)}
            >
              <option value="">Not set</option>
              {SHOPPING_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category[0]!.toUpperCase() + category.slice(1)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <label className={cn("flex h-11 items-center gap-2 text-body text-text-primary", POINTER)}>
          <input
            type="checkbox"
            checked={draft.pantry}
            onChange={(event) => onChange({ pantry: event.target.checked })}
            className={cn("size-[18px] accent-ink", POINTER, FOCUS_RING)}
          />
          Pantry
        </label>
      </div>

      <div className="flex flex-wrap gap-x-5">
        <button
          type="button"
          data-focus={`${key}:up`}
          aria-label={`Move ${called} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className={TEXT_BUTTON}
        >
          Move up
        </button>
        <button
          type="button"
          data-focus={`${key}:down`}
          aria-label={`Move ${called} down`}
          disabled={last}
          onClick={() => onMove(1)}
          className={TEXT_BUTTON}
        >
          Move down
        </button>
        <button
          type="button"
          aria-label={`Remove ${called}`}
          onClick={onRemove}
          className={TEXT_BUTTON}
        >
          Remove
        </button>
      </div>
    </fieldset>
  );
}

/** A micro-labelled group, as the recipe screen labels its sections. */
function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[14px]">
      <h2 className="text-micro uppercase text-text-secondary">{heading}</h2>
      {children}
    </section>
  );
}

type ControlProps = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

/**
 * A label, its control, and the reason it was refused.
 *
 * The control is a render prop so the label can own the id and the
 * description wiring: every input in the sheet is named and points at its own
 * error, and none of them has to remember how.
 */
function Field({
  label,
  unit,
  error,
  hideLabel,
  className,
  children,
}: {
  label: string;
  unit?: string;
  error: string | undefined;
  hideLabel?: boolean;
  className?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-slash text-text-secondary"}>
        {label}
        {unit && <span className="text-text-secondary"> · {unit}</span>}
      </label>

      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? `${id}-error` : undefined,
      })}

      {error && (
        // `role="alert"` so the refusal is heard rather than found.
        <span id={`${id}-error`} role="alert" className="text-slash text-error">
          {error}
        </span>
      )}
    </div>
  );
}
