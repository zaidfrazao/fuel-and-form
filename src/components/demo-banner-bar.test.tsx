import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The demo banner, as the DOM answers P7's criterion — FUEL-42.
 *
 * The criterion is one sentence: "a persistent, dismissible banner marks the
 * session as a demo and links to the repository". Three of the four assertions
 * below are about things that would rot silently rather than break:
 *
 *   - **The copy.** § UI Copy gives it word for word and pairs it with what it
 *     must not become. Nothing about "Welcome to the demo!" would look wrong in
 *     a diff.
 *   - **The link's destination and target.** A "View the source" that goes
 *     nowhere is the one broken thing a portfolio visitor is guaranteed to find.
 *   - **The dismiss control's accessible name.** It is a bare icon, so the
 *     `aria-label` is the only name it has; losing it leaves a button announced
 *     as nothing at all.
 *
 * The fourth is the optimistic hide, which is the one thing here that is not
 * visible from the markup.
 *
 * WHO sees the banner is `demo-banner.test.tsx`; what dismissing it WRITES is
 * `app/actions/demo-banner.test.ts`.
 */

const { dismissDemoBanner } = vi.hoisted(() => ({ dismissDemoBanner: vi.fn() }));

vi.mock("@/app/actions/demo-banner", () => ({ dismissDemoBanner }));

const { DemoBannerBar } = await import("./demo-banner-bar");

/**
 * An action held open, and the handle that lets it go.
 *
 * `right-now.test.tsx`'s helper, for its reason: the optimistic case has to
 * observe the screen while the server has not answered, and a promise that never
 * resolves poisons every later test in the file — React runs transitions one at
 * a time, so one left pending makes the next sit behind it and time out.
 */
function deferred<T>() {
  let settle!: (value: T) => void;
  let fail!: (reason: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  return { promise, settle, fail };
}

beforeEach(() => {
  vi.clearAllMocks();
  dismissDemoBanner.mockResolvedValue(undefined);
});

describe("the demo banner", () => {
  test("says what the Brand Guide says, and nothing else", () => {
    render(<DemoBannerBar />);

    // Asserted as one string across the element boundary the link introduces,
    // so a rewrite that splits or pads the sentence fails here.
    expect(screen.getByRole("complementary").textContent).toContain(
      "Demo session — your changes are temporary. View the source.",
    );
  });

  test("links to the repository", () => {
    render(<DemoBannerBar />);

    const link = screen.getByRole("link", { name: "View the source." });

    expect(link.getAttribute("href")).toBe("https://github.com/zaidfrazao/fuel-and-form");
  });

  test("opens the repository in a new tab, so the demo survives it", () => {
    // Two hours is the session's whole life; a visitor who navigated away would
    // come back to a demo they have to start over.
    render(<DemoBannerBar />);

    const link = screen.getByRole("link", { name: "View the source." });

    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  test("is a landmark a screen reader can skip", () => {
    // It is on every screen, so without the label it is an unnamed region
    // announced before the page's own content, every time.
    render(<DemoBannerBar />);

    expect(screen.getByRole("complementary").getAttribute("aria-label")).toBe("Demo session");
  });

  test("names its dismiss control", () => {
    // A bare X. The label is the only name it has.
    render(<DemoBannerBar />);

    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  describe("dismissing it", () => {
    test("goes on the frame of the tap, not the frame of the answer", async () => {
      // The action is left hanging on purpose, so anything that happens here
      // can only have come from the optimistic layer.
      const pending = deferred<void>();

      dismissDemoBanner.mockReturnValue(pending.promise);

      render(<DemoBannerBar />);

      await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());

      pending.settle();
      await waitFor(() => expect(dismissDemoBanner).toHaveBeenCalledOnce());
    });

    test("tells the server", async () => {
      render(<DemoBannerBar />);

      await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      await waitFor(() => expect(dismissDemoBanner).toHaveBeenCalledOnce());
    });

    test("comes back when the dismissal did not land", async () => {
      // What `useOptimistic` buys over `useState`. A dropped connection means
      // no cookie was written, so the banner is still the truth — and a
      // `useState(true)` would have hidden it until the next full load with
      // nothing to explain why it returned.
      //
      // Held open and rejected by hand rather than `mockRejectedValue`, so the
      // hidden state is OBSERVED before the failure arrives. Rejecting
      // immediately would let this pass on a component that never hid the
      // banner at all — the assertion would be true before the click.
      const pending = deferred<void>();

      dismissDemoBanner.mockReturnValue(pending.promise);

      render(<DemoBannerBar />);

      await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());

      pending.fail(new Error("connection terminated"));

      await waitFor(() => expect(screen.getByRole("complementary")).toBeTruthy());
    });
  });
});
