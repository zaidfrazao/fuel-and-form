"use client";

import { useActionState } from "react";

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
 */
export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(logIn, undefined);

  return (
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

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        {/*
         * The demo entry point the acceptance criteria ask for. Disabled until
         * FUEL-40 provisions a demo session — visible and honest about why,
         * rather than a live-looking button that does nothing, which is the
         * one thing worse than an absent one.
         */}
        <Button type="button" variant="secondary" disabled>
          Try the demo
        </Button>

        <p className="text-caption text-text-secondary">
          The demo opens a temporary account with sample data. Available soon.
        </p>
      </div>
    </form>
  );
}
