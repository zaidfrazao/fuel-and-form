import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/*
 * Brand Guide § Component Patterns → Buttons, and § Implementation Notes
 * override 4: `default` is an ink fill, never the accent — the accent means
 * "now" and is not an action colour. `secondary` is outlined, not filled.
 *
 * Heights live on `size` rather than `variant` because cva emits variant
 * classes before size classes, so a height set on the variant would lose to
 * the size on every conflict. `default` therefore carries the guide's 52px
 * primary height and `sm` its 46px secondary height. No size drops below the
 * 44px touch minimum — shadcn's defaults start at 24px.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-body font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary — the one action the screen exists for. One per screen.
        default: "bg-ink text-ink-fg font-semibold hover:bg-ink/90",
        // Secondary — real actions that aren't the main one: Swap, Skip, Partial.
        secondary: "border-border text-foreground hover:bg-surface",
        outline: "border-border text-foreground hover:bg-surface",
        ghost: "text-foreground hover:bg-surface",
        // Destructive — no fill; it is filled only inside a confirmation sheet.
        destructive: "text-destructive hover:bg-destructive/10",
        // Text — tertiary actions: Revert, Repeat for 2 days.
        link: "text-foreground underline decoration-text-tertiary underline-offset-4",
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
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
