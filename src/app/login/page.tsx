import type { Metadata } from "next";

import { LoginForm } from "./login-form";

/**
 * The single-password gate.
 *
 * A server component holding no logic: the form is a client component because
 * `useActionState` requires one, and everything that decides anything lives in
 * the Server Action behind it.
 *
 * Deliberately does NOT read the session to bounce an already-signed-in
 * visitor. There is nothing to bounce them to yet — the app is a scaffold until
 * Phase 2 — and an auth check in a layout or page is the wrong place for one
 * anyway: it does not stop nested segments or Server Actions from running. The
 * check belongs next to the data, which is where getSession() and scope() put
 * it.
 */

export const metadata: Metadata = {
  title: "Sign in · Fuel & Form",
  // Nothing here should be indexed: it is a login screen on a public URL whose
  // only interesting property is that it exists.
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-title">Fuel &amp; Form</h1>
        <p className="text-body text-text-secondary">
          Sign in to reach your plan, or open the demo to look around.
        </p>
      </div>

      <LoginForm />
    </main>
  );
}
