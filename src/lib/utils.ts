import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/*
 * The Brand Guide's type scale uses names tailwind-merge doesn't ship with
 * (Display, Title, Value, Body, Slash, Micro). Left unregistered, it reads
 * `text-body` and `text-micro` as *colours* and treats them as conflicting
 * with `text-ink-fg`, silently dropping one of the pair — which rendered ink
 * text on an ink fill. Registering them under `font-size` keeps size and
 * colour in separate conflict groups.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["display", "title", "value", "body", "slash", "micro"] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
