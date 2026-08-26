"use client";

import { usePathname } from "next/navigation";

import { NavShell } from "@/components/nav-shell";

/**
 * The shell, wired to the real URL — the one thing FUEL-57 deliberately left
 * undecided.
 *
 * `NavShell` takes `pathname` as a prop and reads no router, which is what lets
 * it render on the server and lets `/dev/nav-shell` show eight active states on
 * one page. Something still has to know which route the user is actually on, and
 * this is the smallest thing that can: a client boundary with no logic in it, no
 * state, and one call.
 *
 * ## Why the boundary is here and not in `NavShell`
 *
 * `usePathname` is a client hook, so wherever it is called becomes a client
 * component along with everything it renders. Calling it inside `NavShell` would
 * make the whole shell — its four marks, its sidebar foot, the route table it
 * imports — client-only, for one string. Here the boundary encloses four lines
 * and `NavShell` stays a server component that happens to be rendered by one.
 *
 * FUEL-57 named the other reason: Next 16 makes `usePathname` suspend under
 * `cacheComponents`. That flag is off in `next.config.ts` today, but if it is
 * ever turned on, the fix is a `<Suspense>` around THIS component rather than a
 * change to the shell.
 *
 * ## It re-renders, and that is the point
 *
 * The layout does not re-render on navigation within the group — that is the
 * whole reason the shell lives in a layout rather than on seven pages. But
 * `usePathname` subscribes to the router, so this component re-renders on every
 * route change and the active item moves. Without it the shell would light `/`
 * forever after the first load.
 *
 * `className` is forwarded rather than owned: where the shell sits in the page
 * column is the layout's argument, and it is made there.
 */
export function NavShellMount({ className }: { className?: string }) {
  const pathname = usePathname();

  return <NavShell pathname={pathname} className={className} />;
}
