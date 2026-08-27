"use client";

import { useEffect, useRef, useState } from "react";

import { NavShell } from "@/components/nav-shell";

/**
 * Asserts `--nav-shell-h` against the shell it describes — FUEL-65.
 *
 * The variable exists because two things that never import each other have to
 * agree about one number. The shell is pinned to the bottom of the phone
 * viewport; `/`'s and `/training`'s action bars are pinned just above it, and
 * they find "just above" by reading `--nav-shell-h` out of globals.css. Nothing
 * derives that value from the shell — it is a sum of the shell's own paddings
 * and its pill, written out by hand — so a change to the pill's geometry can
 * make it wrong, and the failure is that a bar slides under the shell and the
 * screen's primary action is covered. Silent, and on the two screens the PRD
 * measures.
 *
 * So it is measured rather than trusted. Both numbers come out of layout: the
 * shell's own `getBoundingClientRect().height`, and a probe element whose height
 * IS `var(--nav-shell-h)`, which is how a `calc()` holding an `env()` gets
 * resolved without reimplementing it here.
 *
 * ## Only below 1024px
 *
 * Above it the shell is a sidebar — a column as tall as its content, with no
 * bottom pin and no bar to clear — so the variable describes nothing and the
 * comparison would fail for the right reason and read as a bug. The check
 * reports the viewport it is judging and steps aside above the breakpoint.
 */
export function ShellHeightCheck() {
  const shellRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{
    shell: number;
    variable: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    const measure = () => {
      const shell = shellRef.current?.firstElementChild;
      const probe = probeRef.current;
      if (!shell || !probe) return;
      setResult({
        shell: shell.getBoundingClientRect().height,
        variable: probe.getBoundingClientRect().height,
        width: window.innerWidth,
      });
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  /*
   * Half a pixel, not zero. Both numbers are fractional — the pill's 1px borders
   * and the 12.5px label leave the shell on a subpixel boundary at some zoom
   * levels — and a check that demands exact equality reports a failure the first
   * time someone views this page at 110%. Half a pixel is far below the 86px
   * this is guarding and far above the noise.
   */
  const agrees = result ? Math.abs(result.shell - result.variable) < 0.5 : false;
  const applies = result ? result.width < 1024 : false;

  return (
    <div className="flex flex-col gap-3">
      {/*
       * The probe. `h-[var(--nav-shell-h)]` is the whole point of it: the
       * browser resolves the calc and the env inset, and the result is readable
       * as a height. `w-px` and `opacity-0` rather than `hidden`, because an
       * element that is not laid out has no height to read.
       */}
      <div ref={probeRef} className="h-[var(--nav-shell-h)] w-px opacity-0" />

      {/*
       * The shell itself, at its natural height. No `className` override — the
       * whole question is what the component measures when nothing is done to
       * it, so anything passed here would be measuring the override instead.
       */}
      <div ref={shellRef} className="rounded-lg border border-border">
        <NavShell pathname="/" />
      </div>

      <p className="text-body text-text-secondary" role="status">
        {result === null ? (
          "Measuring…"
        ) : !applies ? (
          <>
            Viewport {Math.round(result.width)}px — at or above 1024 the shell is
            a sidebar and <code>--nav-shell-h</code> describes nothing. Narrow
            the window below 1024px to run the check.
          </>
        ) : (
          <>
            {agrees ? "AGREES" : "DISAGREES"} — the shell measures{" "}
            {result.shell.toFixed(2)}px and <code>--nav-shell-h</code> resolves
            to {result.variable.toFixed(2)}px, at a {Math.round(result.width)}px
            viewport.
            {agrees
              ? " The action bars on / and /training clear the shell exactly."
              : " The action bars on / and /training are offset by the wrong amount, and one of them is covering a primary action. Correct --nav-shell-h in globals.css."}
          </>
        )}
      </p>
    </div>
  );
}
