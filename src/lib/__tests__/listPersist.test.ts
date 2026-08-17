import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CardTitle } from "@/components/TitleCard";
import { listCache, emptyListState, type ListState } from "@/lib/listCache";
import {
  persistLists,
  readPersistedLists,
  hydrateListCache,
  clearPersistedLists,
  projectCard,
} from "@/lib/listPersist";

const KEY = "watchlist:lists";

function card(i: number, overrides: Partial<CardTitle> = {}): CardTitle {
  return {
    id: `id${i}`,
    title: `Film ${i}`,
    year: 2000 + i,
    posterUrl: `https://image.tmdb.org/t/p/w500/p${i}.jpg`,
    myRating: null,
    imdbScore: "7.5",
    genres: ["Drama"],
    mediaType: "MOVIE",
    pinned: false,
    ...overrides,
  };
}

function loaded(titles: CardTitle[]): ListState {
  return { titles, loaded: true, fetching: false, error: false };
}

function stored(payload: unknown) {
  window.localStorage.setItem(KEY, JSON.stringify(payload));
}

beforeEach(() => {
  window.localStorage.clear();
  listCache.WANT = emptyListState;
  listCache.WATCHED = emptyListState;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("projectCard", () => {
  it("keeps only the fields a card renders", () => {
    // A full row carries overview, cast, watchProviders and more. Persisting
    // those took the payload from ~131 KB to ~1.4 MB against a ~5 MB quota.
    const row = {
      ...card(1),
      overview: "x".repeat(500),
      cast: [{ name: "Someone" }],
      watchProviders: [{ name: "Netflix" }],
      tagline: "A tagline",
      moods: ["Weird"],
    } as unknown as CardTitle;

    expect(Object.keys(projectCard(row)).sort()).toEqual([
      "genres",
      "id",
      "imdbScore",
      "mediaType",
      "myRating",
      "pinned",
      "posterUrl",
      "title",
      "year",
    ]);
  });

  it("normalises missing values to null so the stored shape is stable", () => {
    const sparse = { id: "a", title: "T", mediaType: "TV" } as unknown as CardTitle;
    expect(projectCard(sparse)).toEqual({
      id: "a",
      title: "T",
      year: null,
      posterUrl: null,
      myRating: null,
      imdbScore: null,
      genres: [],
      mediaType: "TV",
      pinned: false,
    });
  });
});

describe("persistLists then readPersistedLists", () => {
  it("round-trips both lists", () => {
    persistLists({ WANT: loaded([card(1), card(2)]), WATCHED: loaded([card(3)]) });

    const read = readPersistedLists();
    expect(read?.WANT).toHaveLength(2);
    expect(read?.WATCHED).toHaveLength(1);
    expect(read?.WANT?.[0].title).toBe("Film 1");
  });

  it("writes the projection, not whole rows", () => {
    const fat = { ...card(1), overview: "SHOULD_NOT_PERSIST" } as unknown as CardTitle;
    persistLists({ WANT: loaded([fat]), WATCHED: emptyListState });

    expect(window.localStorage.getItem(KEY)).not.toContain("SHOULD_NOT_PERSIST");
  });

  it("does not persist a list that is still loading or errored", () => {
    persistLists({
      WANT: loaded([card(1)]),
      WATCHED: { titles: [], loaded: false, fetching: true, error: false },
    });

    const read = readPersistedLists();
    expect(read?.WANT).toHaveLength(1);
    // Null, not empty: an unloaded list must not come back looking loaded-empty.
    expect(read?.WATCHED).toBeNull();
  });

  it("preserves the other list when only one reloads", () => {
    persistLists({ WANT: loaded([card(1)]), WATCHED: loaded([card(9)]) });
    // A later WANT-only refresh, with WATCHED mid-flight.
    persistLists({
      WANT: loaded([card(1), card(2)]),
      WATCHED: { titles: [], loaded: false, fetching: true, error: false },
    });

    const read = readPersistedLists();
    expect(read?.WANT).toHaveLength(2);
    expect(read?.WATCHED?.[0].id).toBe("id9");
  });

  it("never overwrites good data with an error state", () => {
    persistLists({ WANT: loaded([card(1)]), WATCHED: loaded([card(2)]) });
    persistLists({
      WANT: { titles: [], loaded: true, fetching: false, error: true },
      WATCHED: loaded([card(2)]),
    });

    expect(readPersistedLists()?.WANT?.[0].id).toBe("id1");
  });
});

describe("readPersistedLists rejects anything untrustworthy", () => {
  it("returns null when nothing is stored", () => {
    expect(readPersistedLists()).toBeNull();
  });

  it("returns null for unparseable JSON", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(readPersistedLists()).toBeNull();
  });

  it("returns null on a schema version mismatch", () => {
    stored({ v: 999, lists: { WANT: [card(1)], WATCHED: null } });
    expect(readPersistedLists()).toBeNull();
  });

  it("returns null when the envelope is the wrong shape", () => {
    for (const payload of [null, 42, "text", [], { lists: { WANT: [] } }, { v: 1 }]) {
      stored(payload);
      expect(readPersistedLists()).toBeNull();
    }
  });

  it("rejects a list containing a malformed card", () => {
    stored({ v: 1, lists: { WANT: [card(1), { id: "x" }], WATCHED: null } });
    // One bad card invalidates its list rather than rendering a grid with holes.
    expect(readPersistedLists()).toBeNull();
  });

  it("rejects a card with a wrong field type", () => {
    stored({ v: 1, lists: { WANT: [{ ...card(1), pinned: "yes" }], WATCHED: null } });
    expect(readPersistedLists()).toBeNull();
  });

  it("rejects a card with an unknown mediaType", () => {
    stored({ v: 1, lists: { WANT: [{ ...card(1), mediaType: "PODCAST" }], WATCHED: null } });
    expect(readPersistedLists()).toBeNull();
  });

  it("self-invalidates when a field is ADDED to the card shape", () => {
    // A payload written by a future version carries an extra key. The exact
    // field match rejects it, so no version bump is needed for field changes.
    stored({ v: 1, lists: { WANT: [{ ...card(1), newField: 1 }], WATCHED: null } });
    expect(readPersistedLists()).toBeNull();
  });

  it("self-invalidates when a field is REMOVED from the card shape", () => {
    const missingField: Record<string, unknown> = { ...card(1) };
    delete missingField.pinned;
    stored({ v: 1, lists: { WANT: [missingField], WATCHED: null } });
    expect(readPersistedLists()).toBeNull();
  });

  // THE COLD-LAUNCH GUARD. An all-empty payload is indistinguishable from a
  // persistence bug, and rendering "Nothing on your list" when we do not
  // actually know is worse than a momentary skeleton.
  it("treats an all-empty payload as a miss, so the skeleton still shows", () => {
    stored({ v: 1, lists: { WANT: [], WATCHED: [] } });
    expect(readPersistedLists()).toBeNull();
  });

  it("accepts an empty list alongside a populated one", () => {
    stored({ v: 1, lists: { WANT: [card(1)], WATCHED: [] } });
    const read = readPersistedLists();
    expect(read?.WANT).toHaveLength(1);
    expect(read?.WATCHED).toEqual([]);
  });
});

describe("storage failures never crash", () => {
  it("survives a quota error on write", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    expect(() => persistLists({ WANT: loaded([card(1)]), WATCHED: emptyListState })).not.toThrow();
  });

  it("drops the key on a write failure rather than leaving a stale payload", () => {
    persistLists({ WANT: loaded([card(1)]), WATCHED: emptyListState });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    persistLists({ WANT: loaded([card(1), card(2)]), WATCHED: emptyListState });

    expect(readPersistedLists()).toBeNull();
  });

  it("survives storage being denied entirely, as in private mode", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError", "SecurityError");
    });

    expect(readPersistedLists()).toBeNull();
    expect(() => hydrateListCache()).not.toThrow();
  });

  it("survives removeItem also throwing on the failure path", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new DOMException("SecurityError", "SecurityError");
    });

    expect(() => persistLists({ WANT: loaded([card(1)]), WATCHED: emptyListState })).not.toThrow();
  });
});

describe("hydrateListCache", () => {
  it("seeds the in-memory singleton and reports that it did", () => {
    persistLists({ WANT: loaded([card(1), card(2)]), WATCHED: loaded([card(3)]) });

    expect(hydrateListCache()).toBe(true);
    expect(listCache.WANT.titles).toHaveLength(2);
    expect(listCache.WANT.loaded).toBe(true);
    expect(listCache.WATCHED.titles).toHaveLength(1);
  });

  it("reports false and changes nothing when there is no cache", () => {
    expect(hydrateListCache()).toBe(false);
    expect(listCache.WANT.loaded).toBe(false);
    expect(listCache.WANT.titles).toEqual([]);
  });

  it("leaves an already-loaded list alone, since memory is fresher than disk", () => {
    persistLists({ WANT: loaded([card(1)]), WATCHED: loaded([card(2)]) });
    listCache.WANT = loaded([card(99)]);

    hydrateListCache();

    expect(listCache.WANT.titles[0].id).toBe("id99");
    // The untouched list still seeds.
    expect(listCache.WATCHED.titles[0].id).toBe("id2");
  });

  it("seeds a list as not fetching, so the network path can set its own flags", () => {
    persistLists({ WANT: loaded([card(1)]), WATCHED: loaded([card(2)]) });
    hydrateListCache();
    expect(listCache.WANT.fetching).toBe(false);
    expect(listCache.WANT.error).toBe(false);
  });

  it("does not seed a list that was never persisted", () => {
    persistLists({
      WANT: loaded([card(1)]),
      WATCHED: { titles: [], loaded: false, fetching: true, error: false },
    });

    hydrateListCache();

    expect(listCache.WANT.loaded).toBe(true);
    // Still cold, so Home shows its skeleton on the Watched tab rather than a
    // false "nothing watched yet".
    expect(listCache.WATCHED.loaded).toBe(false);
  });

  it("is idempotent, so every entry point can call it", () => {
    persistLists({ WANT: loaded([card(1)]), WATCHED: loaded([card(2)]) });

    expect(hydrateListCache()).toBe(true);
    expect(hydrateListCache()).toBe(false);
    expect(listCache.WANT.titles).toHaveLength(1);
  });
});

describe("clearPersistedLists", () => {
  it("removes the payload", () => {
    persistLists({ WANT: loaded([card(1)]), WATCHED: emptyListState });
    clearPersistedLists();
    expect(readPersistedLists()).toBeNull();
  });
});

describe("payload size", () => {
  it("stays far below the localStorage quota at real library scale", () => {
    // The live library is 532 titles and serializes to ~131 KB, about 2.6% of a
    // 5 MB quota. This guards the projection: persisting whole rows measured
    // ~1.4 MB, and any future field creep should trip this long before a user
    // hits a real quota error.
    const many = Array.from({ length: 600 }, (_, i) =>
      card(i, {
        title: "A Reasonably Long Film Title Goes Here",
        genres: ["Drama", "Thriller", "Science Fiction"],
      }),
    );
    persistLists({ WANT: loaded(many), WATCHED: loaded(many.slice(0, 250)) });

    const bytes = window.localStorage.getItem(KEY)!.length;
    expect(bytes).toBeLessThan(1024 * 1024);
  });
});
