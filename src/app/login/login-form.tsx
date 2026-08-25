"use client";

import { useActionState } from "react";

import { type DemoState, startDemo } from "@/app/actions/demo";
import { Button } from "@/components/ui/button";
import { logIn, type LoginState } from "./actions";

/**
 * The password field and the demo entry point.
 *
 * A client component only because `useActionState` needs one — the password
 * never leaves the form except in the POST that `logIn` handles on the server.
 * Nothing here reads an environment variable, and nothing here decides whether
 * the password is right.
 *
 * Brand Guide § Feedback: failure is an inline banner at the point of action,
 * never a modal. § Voice: plain and direct — "Incorrect password.", not "Oops!"
 *
 * ## Two forms, not one
 *
 * The demo has a form of its own rather than a second button inside the login
 * form, and the separation is not cosmetic. A `<form>` submits every field it
 * contains, so a demo button sitting inside the password form would send the
 * password — typed, or filled in by a password manager — to an endpoint that
 * has no business receiving it, on every single click. Nothing would look
 * wrong; the value would simply be in a second request, and in whatever sits in
 * front of it.
 *
 * Each form also gets its own `useActionState`, so a refusal from one cannot
 * surface under the other. That matters here more than it usually would: the
 * two actions deliberately do NOT share a failure vocabulary — see the note on
 * `Refusal` in src/lib/demo.ts — and rendering one's message in the other's
 * banner would undo exactly the distinction that note argues for.
 */
export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(logIn, undefined);

  const [demo, demoAction, demoPending] = useActionState<DemoState, FormData>(
    startDemo,
    undefined,
  );

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-label text-text-secondary">
            Password
          </label>

          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            // The owner's own device, their own password manager. Autofocus is
            // the right call on a screen whose only purpose is this one field.
            autoFocus
            required
            aria-invalid={state ? true : undefined}
            aria-describedby={state ? "password-error" : undefined}
            className="h-13 rounded-md border border-border bg-surface px-4 text-body text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive"
          />

          {state ? (
            // `role="alert"` so a screen reader hears the refusal rather than
            // finding it later. The message is the same for every failure — see
            // actions.ts on why it must not vary.
            <p id="password-error" role="alert" className="text-caption text-error">
              {state.error}
            </p>
          ) : null}
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {/*
       * P7's demo entry point, live as of FUEL-40.
       *
       * A submit button rather than a link: provisioning writes an account and
       * a whole library beneath it, so it has to be a POST behind a deliberate
       * action. A GET would be followed by every crawler, preview fetcher and
       * link-unfurler that ever saw this page, each one provisioning an account
       * nobody asked for. See src/app/actions/demo.ts.
       */}
      <form action={demoAction} className="flex flex-col gap-2 border-t border-border pt-4">
        <Button type="submit" variant="secondary" disabled={demoPending}>
          {demoPending ? "Opening the demo…" : "Try the demo"}
        </Button>

        {demo ? (
          // `role="alert"` for the same reason the password refusal has one: a
          // message that is only coloured is one a screen reader finds late, or
          // not at all.
          <p id="demo-error" role="alert" className="text-caption text-error">
            {demo.error}
          </p>
        ) : (
          <p className="text-caption text-text-secondary">
            The demo opens a temporary account with sample data. Nothing you do in
            it touches anyone else&rsquo;s.
          </p>
        )}
      </form>
    </div>
  );
}
