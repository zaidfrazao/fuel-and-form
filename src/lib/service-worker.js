/**
 * The service worker — FUEL-47, PRD § P9.
 *
 * The only code in this app that runs when the app is not open, and the whole
 * reason P9's second layer can exist at all: a push arrives at the browser, the
 * browser wakes this file, and this file is what turns it into something on a
 * lock screen.
 *
 * ## Plain JavaScript, and not a `.ts` file
 *
 * A service worker runs in its own global scope — `self` is a
 * `ServiceWorkerGlobalScope`, not a `Window` — and the app's `tsconfig.json`
 * types every file against the DOM. Typing this one correctly would mean a
 * second tsconfig for a single file whose entire surface is two event listeners.
 * It is registered through `new URL(..., import.meta.url)`, so the bundler still
 * emits and fingerprints it; it is simply not typechecked.
 *
 * ## It caches nothing
 *
 * This is not an offline layer. The PRD lists "offline support / PWA install —
 * service worker caching for the kitchen" under Nice-to-Have, explicitly
 * deferred, and a worker that started intercepting `fetch` would take over
 * serving the entire app — including, on a stale registration, an old build.
 * That is a large and permanent risk taken on behalf of a feature the PRD names
 * as the first to cut. There is no `install`, no `activate` and no `fetch`
 * handler here on purpose.
 *
 * ## The push handler assumes nothing about the payload
 *
 * `lib/push.ts` builds it and `api/cron/walk-reminder` sends it, so in practice
 * it is always this app's own JSON — but a service worker registered on this
 * origin can be woken by any push delivered to its subscription, and a `push`
 * handler that threw would be a worker the browser eventually stops trusting.
 * So a payload that will not parse is shown as the reminder anyway: something
 * arrived for this origin, and the walk is the only thing this app pushes about.
 *
 * `userVisibleOnly: true` is set at subscription time — every browser that
 * supports web push requires it — which means the browser will show a generic
 * "this site was updated in the background" notification if this handler
 * finishes without showing one. Falling back to real copy is what stops that.
 */

/** Matches `WalkNotification` in src/lib/push.ts, and its `/` destination. */
const FALLBACK = {
  title: "Fuel & Form",
  body: "Walk not logged. Log the walk.",
  url: "/",
};

self.addEventListener("push", (event) => {
  let payload = FALLBACK;

  try {
    // `event.data` is null when a push arrives with no body at all, which is a
    // legal thing for a push service to deliver.
    if (event.data) payload = { ...FALLBACK, ...event.data.json() };
  } catch {
    // Deliberately empty: `payload` is still the fallback, and a worker that
    // threw here would show nothing and be penalised for it.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // `renotify` needs a tag, and the tag is what makes this feature's cap
      // hold on the DEVICE as well as in the database: a second notification
      // with the same tag replaces the first rather than stacking beneath it.
      // The scheduled job should never send two, but a push service retrying a
      // delivery is outside its control.
      tag: "walk-reminder",
      data: { url: payload.url },
    }),
  );
});

/**
 * P9's fourth criterion: "notification deep-links to the walk logging action".
 *
 * Focusing an already-open tab is the half that is easy to leave out and the
 * half a person notices. Opening a second window onto an app they already have
 * open loses whatever they were doing — a half-typed weigh-in, a sheet mid-swap
 * — so an existing client is focused and navigated instead, and a new window is
 * opened only when there is genuinely nothing to focus.
 *
 * `includeUncontrolled: true` because this worker claims no clients: it has no
 * `activate` handler calling `clients.claim()`, so tabs opened before it
 * registered are uncontrolled and would otherwise be invisible here — which is
 * every tab, on the first install.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url ?? FALLBACK.url;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          // Navigate first, then focus. The other order shows the page they left
          // and then moves it under them, which reads as the app jumping.
          //
          // `navigate()` resolves with the client, or with NULL if it was
          // discarded while navigating — a tab the OS reclaimed under memory
          // pressure, which is exactly the state a phone is in when a
          // notification wakes it. Falling back to the original client means the
          // tap still focuses something instead of throwing inside `waitUntil`,
          // where the failure would be a notification that visibly does nothing.
          if (!client.navigate) return client.focus();

          return client.navigate(url).then((navigated) => (navigated ?? client).focus());
        }
      }

      return self.clients.openWindow(url);
    }),
  );
});
