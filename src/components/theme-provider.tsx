"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Brand Guide § Appearance Modes — "System-adaptive. Both modes are first-class
 * and fully specified; neither is a derived afterthought."
 *
 * next-themes writes a synchronous script into <head> that resolves the theme
 * and sets the class on <html> while the HTML is still parsing, so the correct
 * mode is in place before the first paint. That is the technique Next's own
 * "preventing flash before hydration" guide prescribes; it also means <html>
 * needs `suppressHydrationWarning`, since the DOM React hydrates against has
 * already been changed.
 *
 * The props are fixed here rather than passed in — there is one correct
 * configuration for this app and no reason for a caller to vary it.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Sets `color-scheme` on <html> to the resolved mode, so native controls
      // and scrollbars follow. On by default, but stated explicitly: the
      // viewport export in layout.tsx claims this happens, and that claim
      // should not rest on a library default surviving an upgrade.
      enableColorScheme
      // The Brand Guide's motion rules: a value that merely updated does not
      // animate. Without this, every colour transition in the tree fires at
      // once on a mode switch.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
