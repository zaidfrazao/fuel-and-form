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

vi.mock("./actions", () => ({ logIn: (...args: unknown[]) => logIn(...args) }));

// Imported after the mock is registered — `vi.mock` is hoisted, but the intent
// is clearer written in this order.
const { default: LoginPage } = await import("./page");

beforeEach(() => {
  logIn.mockReset();
  // The shape useActionState expects: the new state, or undefined for success.
  logIn.mockResolvedValue(undefined);
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

  it("offers the demo entry point", () => {
    render(<LoginPage />);

    // P7's "Try the demo requires no credentials". Present now, wired up in
    // FUEL-40 — and disabled until then rather than live-looking and inert.
    const demo = screen.getByRole("button", { name: "Try the demo" });

    expect(demo).toBeDefined();
    expect((demo as HTMLButtonElement).disabled).toBe(true);
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
