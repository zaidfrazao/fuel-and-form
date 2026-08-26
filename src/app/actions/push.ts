"use server";

import { getSession } from "@/lib/auth/session";
import { removeSubscription, saveSubscription } from "@/lib/db/queries/push";

/**
 * Subscribing and unsubscribing a browser — FUEL-47, PRD § P9.
 *
 * P9's "subscribe from settings", and the two writes behind the one control
 * there. The browser has already done the part that matters by the time either
 * of these is called: `pushManager.subscribe()` asked for permission, talked to
 * the push service, and produced an endpoint and a key pair. What crosses here
 * is that result, and all this module does is keep it.
 *
 * ## Treated as a public endpoint, because it is one
 *
 * `actions/settings.ts`'s reading, and it needs restating here because the value
 * being written is unusually inviting. A Server Action is reachable by anyone
 * who can POST to the app, so the session is resolved HERE rather than trusted,
 * and the write goes through `scope()` underneath — which is what stops a caller
 * filing a subscription against somebody else's account, and therefore stops
 * "subscribe" being a way to make a notification appear on another person's
 * phone.
 *
 * The shape is checked before the row, on `slot-times.ts`'s reasoning: three
 * non-empty strings, because a subscription missing its `auth` can never be
 * encrypted for and should fail here rather than at 19:00 six weeks later. What
 * is deliberately NOT checked is the FORM of any of them — see schema.ts. They
 * are opaque values minted by Google, Mozilla and Apple, and a validator with an
 * opinion about them is a notification that silently stops arriving the week one
 * of those three changes something.
 *
 * ## Nothing throws, and nothing reports a failure worth reading
 *
 * Every other action in this app returns `{ ok }` so the form can render Brand
 * Guide § Feedback's inline message. These return `void`.
 *
 * That is P9's third criterion doing the shaping: "push failure degrades
 * silently to the banner — no errors surfaced to the user". There is nothing for
 * a person to do about a subscription that would not save, and the layer that
 * matters is already on their screen. So a failure is logged for whoever runs
 * the app and the control simply reflects what the BROWSER thinks — which is the
 * honest answer either way, since the browser's own subscription is what decides
 * whether a notification can arrive at all.
 */

/**
 * Records this browser against the signed-in user.
 *
 * @param subscription `PushSubscription.toJSON()`, flattened by the caller.
 */
export async function subscribeToWalkReminder(subscription: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<void> {
  try {
    const session = await getSession();

    if (!session) return;

    const { endpoint, p256dh, auth } = subscription;

    if (!endpoint || !p256dh || !auth) return;

    await saveSubscription(session.userId, { endpoint, p256dh, auth });
  } catch (error) {
    // Named for whoever runs the app, and nothing beyond that. The endpoint is
    // deliberately not logged: it is a credential, and this is the one place it
    // arrives from outside.
    console.error("Could not save a push subscription.", error);
  }
}

/**
 * Forgets this browser.
 *
 * Called after `subscription.unsubscribe()` has already succeeded in the
 * browser, so the row is the only thing left. A failure here therefore leaves a
 * row that can never be delivered to — which the scheduled job prunes on its own
 * the next evening, on the 404 the push service answers with.
 */
export async function unsubscribeFromWalkReminder(endpoint: string): Promise<void> {
  try {
    const session = await getSession();

    if (!session || !endpoint) return;

    await removeSubscription(session.userId, endpoint);
  } catch (error) {
    console.error("Could not remove a push subscription.", error);
  }
}
