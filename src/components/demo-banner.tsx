import { cookies } from "next/headers";

import { getSession } from "@/lib/auth/session";
import { DEMO_BANNER_COOKIE, isBannerDismissed } from "@/lib/demo-banner";
import { DemoBannerBar } from "./demo-banner-bar";

/**
 * Whether this session gets a banner — FUEL-42, PRD § P7.
 *
 * P7 asks for "a persistent, dismissible banner [that] marks the session as a
 * demo and links to the repository". Persistent means every screen, which is why
 * this is rendered from the root layout rather than from the five pages that
 * would each have to remember it. `demo-banner-bar.tsx` is what it looks like.
 *
 * ## Why the decision is made on the server
 *
 * So the banner is in the first paint or absent from it. The alternative —
 * render it always, hide it in an effect — paints a banner on the owner's screen
 * and on every dismissed session, then removes it a frame later. On the one
 * session type where the app is being judged in sixty seconds, a flash of
 * something that then disappears is the worst available first impression.
 *
 * ## What it costs, which is less than it looks
 *
 * `getSession` is memoised by React for the length of one render pass, so the
 * page beneath this asking who is signed in — as every page here does — costs
 * one database round trip between them rather than two. On `/login`, which asks
 * nothing, there is no query at all: no cookie means the token fails to verify
 * before any statement is built.
 *
 * Reading cookies here does make every route render dynamically, `/login`
 * included. That is the whole of the price, it is paid on a login screen with
 * nothing to cache, and the alternative — moving five page directories into a
 * route group so this layout could be narrower — is a large diff in service of a
 * page that renders a form.
 *
 * ## Why this carries no `server-only`
 *
 * Nothing in `components/` or `app/` does: the marker lives on the modules that
 * touch a connection or a secret — `lib/env.ts`, `lib/auth/session.ts`, every
 * `lib/db/queries/*` — and reaches this file through `getSession`. Importing it
 * here as well would add nothing a client component could get past and would
 * make this the one component in the app the hermetic suite cannot render.
 *
 * ## Why the owner never sees it
 *
 * There is nothing true to tell them: their changes are not temporary. The
 * session's KIND decides it, rather than the presence of a demo cookie, so an
 * owner who has tried their own demo on the same machine — which
 * `auth/session.ts` deliberately supports — is not told their own data is about
 * to be deleted.
 */
export async function DemoBanner() {
  const session = await getSession();

  if (session?.kind !== "demo") return null;

  // Read only once it is known there is a banner to hide. A cookie whose value
  // names another account — the previous visit's — does not match, which is the
  // same answer as no cookie: this session is new, and its changes are newly
  // temporary. See the note on `isBannerDismissed`.
  const dismissed = (await cookies()).get(DEMO_BANNER_COOKIE)?.value;

  if (isBannerDismissed(dismissed, session.userId)) return null;

  return <DemoBannerBar />;
}
