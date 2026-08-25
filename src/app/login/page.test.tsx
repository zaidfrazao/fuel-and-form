import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The login screen.
 *
 * ## Why the action is mocked
 *
 * `./actions` is a "use server" module: it imports the database, `server-only`
 * and `SESSION_SECRET`, none of which resolve under the hermetic jsdom suite —
 * and none of which this file is testing. What IS tested here is the boundary
 * the browser sees: that the password field cannot be read off the screen, that
 * a refusal is announced rather than merely coloured, and that the demo entry
 * point the acceptance criteria ask for is actually on the page.
 *
 * The real check lives in src/lib/auth/, which is covered without a browser.
 * Splitting it that way is what keeps both halves testable at all.
 */

const logIn = vi.fn();
const startDemo = vi.fn();

vi.mock("./actions", () => ({ logIn: (...args: unknown[]) => logIn(...args) }));
vi.mock("@/app/actions/demo", () => ({
  startDemo: (...args: unknown[]) => startDemo(...args),
}));

// Imported after the mock is registered — `vi.mock` is hoisted, but the intent
// is clearer written in this order.
const { default: LoginPage } = await import("./page");

beforeEach(() => {
  logIn.mockReset();
  startDemo.mockReset();
  // The shape useActionState expects: the new state, or undefined for success.
  logIn.mockResolvedValue(undefined);
  startDemo.mockResolvedValue(undefined);
});

describe("the login screen", () => {
  it("renders the app's name and what the screen is for", () => {
    render(<LoginPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Fuel & Form" })).toBeDefined();
  });

  it("masks the password field", () => {
    render(<LoginPage />);

    // `type="password"` rather than a text input: this screen is used in a
    // kitchen, and the browser's own password manager keys off it too.
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
  });

  it("offers the demo entry point, live", () => {
    render(<LoginPage />);

    // P7's "Try the demo requires no credentials", wired up in FUEL-40. It was
    // deliberately disabled until then; a live-looking button that does nothing
    // is the one thing worse than an absent one, and so is the reverse — this
    // asserts it is not still disabled after being connected.
    const demo = screen.getByRole("button", { name: "Try the demo" });

    expect(demo).toBeDefined();
    expect((demo as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits the demo as a POST rather than following a link", () => {
    render(<LoginPage />);

    // P7: "a POST behind a user action, so crawlers cannot mass-create
    // sessions". A crawler follows an anchor and does not submit a form, so
    // this is the difference between a demo endpoint and an open one.
    const demo = screen.getByRole("button", { name: "Try the demo" });

    expect((demo as HTMLButtonElement).type).toBe("submit");
    expect(screen.queryByRole("link", { name: "Try the demo" })).toBeNull();
  });

  it("keeps the password out of the demo's form", async () => {
    render(<LoginPage />);

    // The reason the demo is a form of its own. Sharing one would submit the
    // password — typed or autofilled — to the provisioning endpoint on every
    // click, with nothing on screen to show for it.
    const demo = screen.getByRole("button", { name: "Try the demo" });
    const password = screen.getByLabelText("Password");

    expect((demo as HTMLButtonElement).form).not.toBe(
      (password as HTMLInputElement).form,
    );
    expect((demo as HTMLButtonElement).form?.querySelector("#password")).toBeNull();
  });

  it("announces a refused demo rather than only colouring it", async () => {
    // Brand Guide § Feedback, and the same claim the password refusal makes:
    // the message has to reach a screen reader, not just the screen.
    startDemo.mockResolvedValue({ error: "The demo is at capacity right now." });

    render(<LoginPage />);

    await userEvent.click(screen.getByRole("button", { name: "Try the demo" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "The demo is at capacity right now.",
      );
    });
  });

  it("says what the demo is before anyone clicks it", () => {
    render(<LoginPage />);

    // § Tone of Voice: describe what will happen rather than nudge. The
    // isolation promise is the one thing a portfolio visitor cannot verify for
    // themselves, so the screen says it.
    expect(
      screen.getByText(/temporary account with sample data/i),
    ).toBeDefined();
  });

  it("sends the password to the server rather than judging it here", async () => {
    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText("Password"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // The client's whole job. Nothing in the browser bundle knows what the
    // right password is, which is the acceptance criterion "verified
    // server-side, never shipped to the client".
    await waitFor(() => expect(logIn).toHaveBeenCalledOnce());

    const formData = logIn.mock.calls[0]?.[1] as FormData;
    expect(formData.get("password")).toBe("hunter2");
  });

  it("announces a refusal without re-rendering what was typed", async () => {
    logIn.mockResolvedValue({ error: "Incorrect password." });

    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText("Password"), "wrong-guess");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // role="alert", so the failure reaches a screen reader instead of being
    // conveyed by colour alone. Brand Guide § Feedback: inline, never a modal.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Incorrect password.");

    // The submitted value must not come back in the returned state and be
    // re-rendered into the field — a rejected password sitting in the DOM is a
    // password on the screen.
    expect(document.body.textContent).not.toContain("wrong-guess");
  });

  it("shows the same refusal when the server fails after a correct password", async () => {
    // The password oracle precommit found. Before the catch in actions.ts, a
    // missing OWNER_PASSWORD or an unreachable database threw — and a thrown
    // Server Action is a 500, a visibly different response reachable ONLY by
    // someone who guessed correctly. Guess wrong, get a form; guess right, get
    // a server error; now you know the password.
    //
    // Asserted from the client's side: whatever went wrong server-side, what
    // comes back is the one message every other failure produces.
    logIn.mockResolvedValue({ error: "Incorrect password." });

    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText("Password"), "the-right-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Incorrect password.");
  });

  it("marks the field invalid so the error is not conveyed by colour alone", async () => {
    logIn.mockResolvedValue({ error: "Incorrect password." });

    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText("Password"), "wrong-guess");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe("true"),
    );
  });
});
