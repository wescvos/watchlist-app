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

// jsdom exposes `window.localStorage` here as an object with NO methods on it,
// so any real call throws a TypeError. (The app survives that: every access is
// wrapped, and a throwing store degrades to "cold launch", exactly as it did
// before persistence existed. But tests need a working store to assert against.)
// Methods are own properties so vi.spyOn can replace them, which is how the
// quota-exceeded and private-mode paths get exercised.
if (typeof window !== "undefined" && typeof window.localStorage?.getItem !== "function") {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(window, "localStorage", { value: stub, configurable: true, writable: true });
}
