import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Fresh module instance, so the session flag starts false. */
async function freshSplash() {
  vi.resetModules();
  const mod = await import("@/components/LaunchSplash");
  return mod.LaunchSplash;
}

const overlay = (c: HTMLElement) => c.querySelector("[aria-hidden='true'].fixed");

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("LaunchSplash", () => {
  it("renders on the very first paint, before any effect runs", async () => {
    const Splash = await freshSplash();
    // No act(): this is the output the server emits and the client's first
    // hydration render produces, which is the whole point of it being here.
    const { container } = render(<Splash ready={false} />);

    expect(overlay(container)).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("holds for a minimum even when the list is ready immediately", async () => {
    const Splash = await freshSplash();
    const { container } = render(<Splash ready />);

    // A splash that vanishes instantly is the flicker it exists to hide.
    await advance(200);
    expect(overlay(container)?.className).toContain("opacity-100");

    await advance(400);
    expect(overlay(container)?.className).toContain("opacity-0");
  });

  it("waits for the list beyond the minimum, then clears once it is ready", async () => {
    const Splash = await freshSplash();
    const { container, rerender } = render(<Splash ready={false} />);

    await advance(700);
    // Minimum passed, but the content is not there yet, so it keeps covering.
    expect(overlay(container)?.className).toContain("opacity-100");

    rerender(<Splash ready />);
    await advance(0);
    expect(overlay(container)?.className).toContain("opacity-0");
  });

  it("gives up after a cap so a genuinely slow load is not hidden forever", async () => {
    const Splash = await freshSplash();
    const { container } = render(<Splash ready={false} />);

    await advance(1500);
    expect(overlay(container)?.className).toContain("opacity-100");

    // Past the cap: hand over to the normal skeleton rather than stall.
    await advance(300);
    expect(overlay(container)?.className).toContain("opacity-0");
  });

  it("unmounts after the fade rather than sitting at opacity 0", async () => {
    const Splash = await freshSplash();
    const { container } = render(<Splash ready />);

    await advance(600);
    expect(overlay(container)).not.toBeNull();

    await advance(300);
    expect(container.firstChild).toBeNull();
  });

  it("NEVER shows again once the session has seen it (back-navigation)", async () => {
    const Splash = await freshSplash();
    const first = render(<Splash ready />);
    await advance(1000);
    first.unmount();

    // A remount is what Back from a title page does. It must not return.
    const second = render(<Splash ready={false} />);
    expect(overlay(second.container)).toBeNull();
    expect(second.container.firstChild).toBeNull();
  });

  it("is decorative: hidden from assistive tech, with no announced text", async () => {
    const Splash = await freshSplash();
    const { container } = render(<Splash ready={false} />);

    const el = overlay(container)!;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.textContent).toBe("");
    // Inline SVG, not an <img>, so no request can land after the frame we cover.
    expect(container.querySelector("img")).toBeNull();
  });

  it("uses the app's own background colour, so the handover is invisible", async () => {
    const Splash = await freshSplash();
    const { container } = render(<Splash ready={false} />);
    // Same value as the manifest background_color and globals.css --background.
    expect(overlay(container)?.className).toContain("bg-[#0a0a0a]");
  });
});
