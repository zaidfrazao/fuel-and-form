"use client";

import { useEffect, useState, useTransition } from "react";

import { subscribeToWalkReminder, unsubscribeFromWalkReminder } from "@/app/actions/push";
import { Button } from "@/components/ui/button";

/**
 * The walk reminder's push control — FUEL-47, PRD § P9's "subscribe from
 * settings".
 *
 * One button with two labels, and a sentence above it saying what is true. It
 * sits beneath the slot times because that is where the reminder TIME is
 * configured, and this is the same reminder delivered a second way.
 *
 * ## Every failure here is the same failure, and it is not an error
 *
 * P9: "push failure degrades silently to the banner — no errors surfaced to the
 * user". That is not a catch block bolted on at the end; it is why this
 * component has no error state at all. Permission denied, permission dismissed,
 * a push service that would not mint an endpoint, a browser that has never
 * supported any of it — all of them end with `subscription` null and the same
 * sentence, because they all mean the same thing to the person reading it: this
 * device will not be notified, and the banner still will be.
 *
 * A red inline message would be worse than useless. There is nothing to retry
 * that the button does not already offer, and the app's actual reminder — the
 * banner, which the PRD calls "cheap, reliable, always built" — is unaffected.
 * § Feedback asks for an inline message "at the point of action" for actions
 * that FAILED; this one has no failure a person is expected to act on.
 *
 * ## The browser is the source of truth, not the database
 *
 * State is read from `registration.pushManager.getSubscription()` on mount and
 * after every change, never from what the server was told. Those two can
 * disagree in both directions and the browser is right in both: permission
 * revoked in site settings leaves a row that will 410 on the next send, and a
 * restored database row means nothing to a browser that has no subscription. A
 * control that reported the row would tell someone they were subscribed while
 * their phone stayed silent — the one lie this screen must not tell.
 *
 * ## Why this is not a `<form>`
 *
 * Every other control in settings is, because every other one submits values a
 * person typed. This one submits nothing: the work is `pushManager.subscribe()`,
 * which is asynchronous, permission-gated and entirely client-side, and the
 * server is told about its RESULT afterwards. `useActionState` would have
 * nothing to carry — there is no FormData and no state worth rendering — so it
 * is a button and a transition.
 */

/** What the control knows. `undefined` until the first look at the browser. */
type State =
  | { status: "unsupported" }
  | { status: "checking" }
  | { status: "off" }
  | { status: "on"; endpoint: string };

export function PushForm({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<State>({ status: "checking" });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const resolved = await currentState();

      // Guarded because the effect can be torn down while the browser is still
      // deciding — settings is one tap from every screen, and a registration
      // that has to be fetched is not instant on a cold cache.
      if (!cancelled) setState(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = () => {
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.ready;

        const subscription = await registration.pushManager.subscribe({
          // Required by every browser that implements push: a subscription that
          // may be used silently is not one any of them will mint.
          userVisibleOnly: true,
          applicationServerKey: decodeKey(vapidPublicKey),
        });

        const { p256dh, auth } = keysOf(subscription);

        await subscribeToWalkReminder({ endpoint: subscription.endpoint, p256dh, auth });

        setState({ status: "on", endpoint: subscription.endpoint });
      } catch {
        // Denied, dismissed, or refused by the push service. All the same.
        setState({ status: "off" });
      }
    });
  };

  const disable = (endpoint: string) => {
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        await subscription?.unsubscribe();
      } catch {
        // The browser would not let go of it. The server is still told, below:
        // a row with no browser behind it is pruned by the scheduled job on the
        // 404 its next send answers with, and leaving the row while showing
        // "off" would be the control lying in the direction that matters.
      }

      await unsubscribeFromWalkReminder(endpoint);
      setState({ status: "off" });
    });
  };

  // Nothing at all while the browser is being asked. A button that appeared as
  // "Turn on" and flipped to "Turn off" a moment later would be a control that
  // told someone the wrong thing first — see the header.
  if (state.status === "checking") return null;

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-5">
      <h2 className="text-body text-text-primary">Notify this device</h2>

      {state.status === "unsupported" ? (
        <p className="text-slash text-text-secondary">
          This browser cannot receive notifications. On an iPhone, add Fuel &amp;
          Form to the Home Screen and open it from there. The reminder still
          appears in the app either way.
        </p>
      ) : (
        <>
          <p className="text-slash text-text-secondary">
            {state.status === "on"
              ? "This device is notified in the evening when the walk is unlogged. At most once a day."
              : "The reminder appears in the app. Turn this on to be notified when the app is closed."}
          </p>

          <div className="pt-1">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={
                state.status === "on" ? () => disable(state.endpoint) : enable
              }
            >
              {state.status === "on" ? "Turn off" : "Turn on"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * What the browser says about this device, asked once on mount.
 *
 * A function rather than three branches inside the effect, and that is the
 * shape the `react-hooks/set-state-in-effect` rule pushes towards for a good
 * reason: the effect then has exactly one `setState`, reached by one path, and
 * cannot be edited into a version that renders twice before settling.
 *
 * Feature detection first, because `PushManager` is absent on iOS Safari
 * outside an installed PWA — P9's own Risks entry, and the single most likely
 * reason a reader of this screen sees "not available".
 */
async function currentState(): Promise<State> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { status: "unsupported" };
  }

  try {
    const registration = await register();
    const existing = await registration.pushManager.getSubscription();

    return existing ? { status: "on", endpoint: existing.endpoint } : { status: "off" };
  } catch {
    // A registration that fails is a device that cannot be notified, which is
    // the same answer as a browser that never could. See the header.
    return { status: "unsupported" };
  }
}

/**
 * Registers the worker, or returns the registration already there.
 *
 * `new URL(..., import.meta.url)` rather than a path string: it is how the Next
 * 16 guide registers a worker, and it means the file is bundled and fingerprinted
 * like any other asset instead of having to be copied into `public/` by hand and
 * kept in step.
 *
 * `updateViaCache: "none"` so the browser re-fetches the worker rather than
 * serving it from the HTTP cache. A worker is checked for updates on its own
 * schedule, and a cached one can outlive several deployments.
 */
function register(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(
    new URL("../../lib/service-worker.js", import.meta.url),
    { scope: "/", updateViaCache: "none" },
  );
}

/**
 * The subscription's two keys, as the strings the server stores.
 *
 * `toJSON()` rather than `getKey()`, which returns an `ArrayBuffer` this would
 * then have to base64url-encode by hand — the same encoding, done worse. The
 * cast is because TypeScript types `toJSON()` as having optional everything;
 * `actions/push.ts` checks the three values are present before writing, which is
 * where that check belongs anyway, since a hand-rolled POST bypasses this file
 * entirely.
 */
function keysOf(subscription: PushSubscription): { p256dh: string; auth: string } {
  const { keys } = subscription.toJSON() as { keys?: { p256dh?: string; auth?: string } };

  return { p256dh: keys?.p256dh ?? "", auth: keys?.auth ?? "" };
}

/**
 * The VAPID public key, base64url → the bytes `subscribe()` wants.
 *
 * `applicationServerKey` accepts a `BufferSource`, and the key travels as
 * base64url because that is what `web-push` generates and what fits in an
 * environment variable. `atob` decodes standard base64 only, so the two
 * url-safe substitutions are undone first and the padding `=` put back — a
 * base64url string of the length a P-256 point produces is one character short
 * of a multiple of four, so without this it throws.
 */
function decodeKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.padEnd(
    base64url.length + ((4 - (base64url.length % 4)) % 4),
    "=",
  );

  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));

  // Allocated over an explicit ArrayBuffer rather than built with
  // `Uint8Array.from`, which the lib types as `Uint8Array<ArrayBufferLike>` —
  // a union including `SharedArrayBuffer`, which `applicationServerKey` does
  // not accept. The narrower return type is the point of writing it this way.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
