import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { HOVER_FILL, HOVER_GROUND, POINTER } from "@/lib/pointer"
import { cn } from "@/lib/utils"

/*
 * Brand Guide § Component Patterns → Buttons, and § Implementation Notes
 * override 4: `default` is an ink fill, never the accent — the accent means
 * "now" and is not an action colour. `secondary` is outlined, not filled.
 *
 * ## A disabled button does not need a `cursor` of its own
 *
 * The base string sets `cursor-pointer` unconditionally, `disabled:` included,
 * and that is correct rather than an oversight: `disabled:pointer-events-none`
 * takes the element out of hit-testing, so it is never what the pointer is
 * over and its own `cursor` is never consulted. Measured rather than reasoned
 * — with a disabled button under the pointer, `elementFromPoint` returns the
 * PARENT and the cursor drawn is the parent's `default`, while the button's
 * computed style still reads `pointer`. That gap is why the question keeps
 * getting asked: reading the class list, or the computed style, suggests a bug
 * that the browser does not have. A `disabled:cursor-*` override would be a
 * class that can never apply.
 *
 * The guide couples height to variant (Primary 52px, everything else 46px),
 * but the height classes have to live on `size`: cva emits variant classes
 * before size classes, so a height set on the variant loses every twMerge
 * conflict. Button therefore derives the guide's height from the variant when
 * the caller doesn't name a size — see `resolvedSize` below. No size drops
 * below the 44px touch minimum; shadcn's defaults start at 24px.
 */
const OUTLINED = `border-border text-foreground ${HOVER_GROUND}`

const buttonVariants = cva(
  `group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-body font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none ${POINTER} focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
  {
    variants: {
      variant: {
        // Primary — the one action the screen exists for. One per screen.
        default: `bg-ink text-ink-fg font-semibold ${HOVER_FILL}`,
        // Secondary — real actions that aren't the main one: Swap, Skip, Partial.
        // The guide has one outlined variant; shadcn ships two names for it.
        secondary: OUTLINED,
        outline: OUTLINED,
        ghost: `text-foreground ${HOVER_GROUND}`,
        /*
         * Destructive — no fill; it is filled only inside a confirmation sheet.
         *
         * Hovers to `surface` like every other ghost, and § Desktop names this
         * as the one place its rules do NOT ratify what was already here: this
         * variant used to hover to `hover:bg-destructive/10`, "a tinted ground
         * no other control has", where the mock draws `surface`. The ground a
         * hover uses "is not the place to restate what the control does — the
         * `error` text already does that". The filled half of the variant keeps
         * its own fill at 90%, written at its one call site in `weigh-ins.tsx`.
         */
        destructive: `text-destructive ${HOVER_GROUND}`,
        // Text — tertiary actions: Revert, Repeat for 2 days.
        link: `text-foreground underline decoration-text-tertiary underline-offset-4 ${HOVER_GROUND}`,
      },
      size: {
        default: "h-13 gap-2 px-5",
        xs: "h-11 gap-1.5 rounded-sm px-3 text-slash",
        sm: "h-[2.875rem] gap-1.5 px-4",
        lg: "h-14 gap-2 px-6",
        icon: "size-13",
        "icon-xs": "size-11 rounded-sm",
        "icon-sm": "size-[2.875rem]",
        "icon-lg": "size-14",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  // Primary is the guide's 52px; every other variant is its 46px. Only applied
  // when the caller leaves `size` unset, so an explicit size still wins.
  const resolvedSize = size ?? (variant === "default" ? "default" : "sm")

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={resolvedSize}
      className={cn(buttonVariants({ variant, size: resolvedSize, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
