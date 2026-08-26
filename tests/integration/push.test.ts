import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { removeSubscription, saveSubscription } from "@/lib/db/queries/push";
import * as schema from "@/lib/db/schema";
import { scope } from "@/lib/db/scope";

import { testDatabaseUrl } from "./env";
import { type Fixture, seedFixture } from "./fixtures";
import { truncateAll } from "./tables";

/**
 * Subscribing, against a real Postgres — FUEL-47, § P9.
 *
 * `src/lib/push.test.ts` proves the cap's comparison with nothing mocked, and
 * `api/cron/walk-reminder/route.test.ts` proves the route honours it. Neither
 * can see what this file is about, because both stop at the boundary where the
 * question becomes one about ROWS: `ON CONFLICT` is a statement, and whether it
 * preserves the cap or destroys it is decided by Postgres.
 *
 * ## The case this file exists for
 *
 * `pushManager.subscribe()` returns the SAME endpoint for a given browser and
 * application server key, so subscribing twice without unsubscribing in between
 * lands on a row that is already there. Ordinary use opens that door in at least
 * three ways: a second tab, a page reloaded mid-flow, and — the one this task's
 * testing note asks to be checked by hand — permission revoked in site settings
 * and granted again, which leaves the row in place while `getSubscription()`
 * reports none.
 *
 * The first draft of `saveSubscription` reset `last_notified_on` on conflict. In
 * every one of those cases that means a phone notified at seven is notified
 * again at eight, which is the one outcome P9's "one notification per day
 * maximum" names. The assertion below is what stops that coming back, and it
 * cannot live anywhere but here.
 */

const configured = testDatabaseUrl() !== undefined;

const SUBSCRIPTION = {
  endpoint: "https://push.example.test/browser-a",
  p256dh: "BOriginalPublicKeyValue",
  auth: "original-auth-secret",
};

describe.skipIf(!configured)("saving a push subscription", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  /** Alice's rows, read back through the scope that wrote them. */
  const rows = () => scope(fixture.alice.userId, getDb()).select(schema.pushSubscriptions);

  it("keeps one row when the same browser subscribes twice", async () => {
    // The whole reason this is an upsert. A plain insert would collide on the
    // unique index; an index-less insert would grow a duplicate that then
    // delivers a second notification for the same day.
    await saveSubscription(fixture.alice.userId, SUBSCRIPTION);
    await saveSubscription(fixture.alice.userId, SUBSCRIPTION);

    const saved = (await rows()).filter((row) => row.endpoint === SUBSCRIPTION.endpoint);

    expect(saved).toHaveLength(1);
  });

  it("overwrites the keys, which can rotate under a stable endpoint", async () => {
    await saveSubscription(fixture.alice.userId, SUBSCRIPTION);
    await saveSubscription(fixture.alice.userId, {
      ...SUBSCRIPTION,
      p256dh: "BRotatedPublicKeyValue",
      auth: "rotated-auth-secret",
    });

    const [saved] = (await rows()).filter((row) => row.endpoint === SUBSCRIPTION.endpoint);

    // A row holding last week's keys is one every send fails to encrypt for,
    // and the failure carries no status — indistinguishable from the network.
    expect(saved?.p256dh).toBe("BRotatedPublicKeyValue");
    expect(saved?.auth).toBe("rotated-auth-secret");
  });

  it("does NOT clear the day's cap when the same browser subscribes again", async () => {
    // The assertion this file exists for. See the header: re-subscribing does
    // not unsend a notification that already arrived, and treating it as if it
    // did is a second notification in one day through a door ordinary use
    // opens — including the revoke-and-re-grant flow this task asks to be
    // checked by hand.
    await saveSubscription(fixture.alice.userId, SUBSCRIPTION);

    await getDb()
      .update(schema.pushSubscriptions)
      .set({ lastNotifiedOn: "2026-03-02" })
      .where(eq(schema.pushSubscriptions.endpoint, SUBSCRIPTION.endpoint));

    await saveSubscription(fixture.alice.userId, SUBSCRIPTION);

    const [saved] = (await rows()).filter((row) => row.endpoint === SUBSCRIPTION.endpoint);

    expect(saved?.lastNotifiedOn).toBe("2026-03-02");
  });

  it("gives two users their own row for one shared endpoint", async () => {
    // The reason the unique index is `(user_id, endpoint)` and not `endpoint`.
    // This app puts two identities in one browser routinely — a demo visitor
    // arrives on the public URL, and the owner signs in on the same phone — and
    // an index on the endpoint alone would make the second overwrite the first,
    // silently moving a subscription between accounts.
    await saveSubscription(fixture.alice.userId, SUBSCRIPTION);
    await saveSubscription(fixture.bob.userId, SUBSCRIPTION);

    const all = await getDb()
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.endpoint, SUBSCRIPTION.endpoint));

    expect(all).toHaveLength(2);
    expect(new Set(all.map((row) => row.userId))).toEqual(
      new Set([fixture.alice.userId, fixture.bob.userId]),
    );
  });

  it("refuses to unsubscribe a browser belonging to someone else", async () => {
    // `removeSubscription` is scoped, and the endpoint is the only handle a
    // caller has on a subscription — a value another user's browser knows,
    // because it is theirs. Unscoped, "unsubscribe" would be a way to silence
    // any device whose endpoint you had.
    await saveSubscription(fixture.alice.userId, SUBSCRIPTION);

    await removeSubscription(fixture.bob.userId, SUBSCRIPTION.endpoint);

    // Filtered by endpoint: the fixture seeds a subscription of its own for
    // every user, so Alice's total is never one and an unfiltered count here
    // would be asserting against the fixture rather than the scope.
    expect(
      (await rows()).filter((row) => row.endpoint === SUBSCRIPTION.endpoint),
    ).toHaveLength(1);
  });
});

describe.skipIf(!configured)("deleting a user", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await truncateAll(getDb());
    fixture = await seedFixture();
  });

  it("takes their subscriptions with it, by cascade", async () => {
    // P7's reaper deletes expired demo accounts and enumerates no tables; every
    // user-owned table cascades from `users`. Asserted for this table
    // specifically because it is the newest, and because a subscription that
    // outlived its account would be a notification sent on behalf of somebody
    // who no longer exists.
    await saveSubscription(fixture.bob.userId, SUBSCRIPTION);

    await getDb().delete(schema.users).where(eq(schema.users.id, fixture.bob.userId));

    const left = await getDb()
      .select()
      .from(schema.pushSubscriptions)
      .where(
        and(
          eq(schema.pushSubscriptions.userId, fixture.bob.userId),
          eq(schema.pushSubscriptions.endpoint, SUBSCRIPTION.endpoint),
        ),
      );

    expect(left).toHaveLength(0);
  });
});
