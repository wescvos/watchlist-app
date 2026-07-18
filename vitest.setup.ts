import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ResizeObserver (used for measuring the search
// page's fixed header height). A no-op stub is enough for tests that don't
// assert on the resize-triggered remeasurement itself, since jsdom also
// doesn't lay out real box dimensions anyway.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
