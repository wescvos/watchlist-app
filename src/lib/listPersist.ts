import type { CardTitle } from "@/components/TitleCard";
import { listCache, type ListState, type Status } from "@/lib/listCache";

/**
 * Durability layer for `listCache`.
 *
 * The in-memory singleton survives navigation within a session, which is what
 * it was built for, but dies when iOS kills the PWA. So every cold launch paid
 * for a full round trip before a single poster could start downloading. This
 * writes the list to localStorage on every successful load and seeds from it on
 * the next launch, so a cold start paints from disk and revalidates behind it.
 *
 * localStorage is ONLY the durability layer. `listCache` stays the working copy
 * and the network stays the source of truth: persisted data is a fast first
 * paint, never an answer.
 */

const STORAGE_KEY = "watchlist:lists";

// Bump to deliberately invalidate every stored payload. Note that a change to
// the persisted field set invalidates old data automatically as well: the reader
// requires an EXACT field match per card (see isCard), so a payload written
// before a field was added or removed fails validation and is treated as a miss.
// The version is for changes that field-checking cannot catch, e.g. a change in
// what a value MEANS.
const SCHEMA_VERSION = 1;

// Exactly what a card renders. Deliberately NOT the whole row: full rows for
// this library serialize to ~1.4 MB against a ~5 MB quota, where the projection
// is ~131 KB (2.6%). Everything omitted here (overview, cast, watchProviders,
// tagline, runtime, scores other than IMDb, moods) is unused by the grid.
const CARD_FIELDS = [
  "id",
  "title",
  "year",
  "posterUrl",
  "myRating",
  "imdbScore",
  "genres",
  "mediaType",
  "pinned",
] as const;

type PersistedLists = Record<Status, CardTitle[] | null>;

/** Strips a row down to the card fields, normalising absent values to null. */
export function projectCard(t: CardTitle): CardTitle {
  return {
    id: t.id,
    title: t.title,
    year: t.year ?? null,
    posterUrl: t.posterUrl ?? null,
    myRating: t.myRating ?? null,
    imdbScore: t.imdbScore ?? null,
    genres: t.genres ?? [],
    mediaType: t.mediaType,
    pinned: t.pinned ?? false,
  };
}

function isCard(value: unknown): value is CardTitle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;

  // Exact field set, which is what makes a future field change self-invalidating.
  const keys = Object.keys(o);
  if (keys.length !== CARD_FIELDS.length) return false;
  if (!CARD_FIELDS.every((f) => f in o)) return false;

  if (typeof o.id !== "string" || o.id === "") return false;
  if (typeof o.title !== "string") return false;
  if (o.year !== null && typeof o.year !== "number") return false;
  if (o.posterUrl !== null && typeof o.posterUrl !== "string") return false;
  if (o.myRating !== null && typeof o.myRating !== "number") return false;
  if (o.imdbScore !== null && typeof o.imdbScore !== "string") return false;
  if (!Array.isArray(o.genres) || o.genres.some((g) => typeof g !== "string")) return false;
  if (o.mediaType !== "MOVIE" && o.mediaType !== "TV") return false;
  if (typeof o.pinned !== "boolean") return false;
  return true;
}

function parseList(value: unknown): CardTitle[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return null;
  // One bad card invalidates its whole list rather than silently rendering a
  // grid with holes in it. The network path then fills it in properly.
  return value.every(isCard) ? (value as CardTitle[]) : null;
}

/** Raw read with no usefulness judgement, used by the writer to preserve the other list. */
function readRaw(): PersistedLists | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Safari private mode throws on access, not just on write.
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const envelope = parsed as { v?: unknown; lists?: unknown };
  if (envelope.v !== SCHEMA_VERSION) return null;
  if (!envelope.lists || typeof envelope.lists !== "object") return null;

  const lists = envelope.lists as Record<string, unknown>;
  return {
    WANT: parseList(lists.WANT ?? null),
    WATCHED: parseList(lists.WATCHED ?? null),
  };
}

/**
 * The persisted lists, or null when there is nothing trustworthy to seed from.
 *
 * A list is null when it was never persisted, failed validation, or was in
 * flight or errored at write time. Callers must seed only the non-null lists and
 * leave the rest to load normally, so a half-written cache cannot make an
 * unloaded list look loaded-and-empty.
 *
 * An all-empty payload is treated as a MISS on purpose. "We loaded successfully
 * and you own nothing" is indistinguishable here from a persistence bug, and
 * showing "Nothing on your list" when we do not actually know is worse than a
 * momentary skeleton. The cost is that a genuinely empty library sees the
 * skeleton once per launch, which is also its first-run experience.
 */
export function readPersistedLists(): PersistedLists | null {
  const raw = readRaw();
  if (!raw) return null;
  if (raw.WANT === null && raw.WATCHED === null) return null;
  if ((raw.WANT?.length ?? 0) === 0 && (raw.WATCHED?.length ?? 0) === 0) return null;
  return raw;
}

/**
 * Write the lists to disk. Only lists that loaded successfully are written; a
 * list still fetching or in error preserves whatever was already stored, so a
 * failure never erases good data.
 *
 * Never throws: quota exhaustion and private-mode denial both degrade to "the
 * next launch is a cold one", which is exactly the behaviour before this layer
 * existed.
 */
export function persistLists(lists: Record<Status, ListState>): void {
  if (typeof window === "undefined") return;

  const existing = readRaw();
  const usable = (state: ListState, previous: CardTitle[] | null) =>
    state.loaded && !state.error ? state.titles.map(projectCard) : previous;

  const payload: { v: number; lists: PersistedLists } = {
    v: SCHEMA_VERSION,
    lists: {
      WANT: usable(lists.WANT, existing?.WANT ?? null),
      WATCHED: usable(lists.WATCHED, existing?.WATCHED ?? null),
    },
  };

  if (payload.lists.WANT === null && payload.lists.WATCHED === null) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Out of quota, or storage denied. Drop the key so a stale payload cannot
    // outlive the data it was meant to mirror.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing further to do; the cache is simply unavailable.
    }
  }
}

export function clearPersistedLists(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignored: an unwritable store is also an unclearable one.
  }
}

/**
 * Seed the in-memory singleton from disk. Returns true if anything was seeded.
 *
 * Idempotent and cheap, so every entry point can call it: a list already marked
 * loaded in memory is left alone, since memory is fresher than disk by
 * definition.
 *
 * MUST NOT be called during render. Reading localStorage while rendering would
 * make the client's first paint disagree with the prerendered HTML, which is a
 * hydration mismatch. Call it from a layout effect, which runs after hydration
 * but before the browser paints, so the skeleton is never actually shown.
 */
export function hydrateListCache(): boolean {
  const persisted = readPersistedLists();
  if (!persisted) return false;

  let seeded = false;
  for (const status of ["WANT", "WATCHED"] as const) {
    const titles = persisted[status];
    if (!titles || listCache[status].loaded) continue;
    listCache[status] = { titles, loaded: true, fetching: false, error: false };
    seeded = true;
  }
  return seeded;
}
