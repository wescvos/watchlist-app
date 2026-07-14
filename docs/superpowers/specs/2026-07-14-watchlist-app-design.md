# Personal Watchlist App — Design Spec

**Date:** 2026-07-14
**Status:** Approved (pending final implementation-plan review)
**Project location:** `C:\Users\Wesley Vos\dev\watchlist-app`

## 1. Purpose

A personal, mobile-first web app to track movies and TV series the owner wants to
watch and has already watched. It replaces Google's built-in "want to watch" /
"already watched" feature, which offers no consolidated watched list. This app
becomes the single source of truth so both lists can be browsed any time and
recently watched titles can be referenced in conversation.

Single user (the owner). No multi-user accounts in v1.

## 2. Core use cases

- Search for a movie or series and see its details before deciding.
- Mark a title as **Want to watch** or **Already watched**.
- View the full **Want to watch** list and the full **Already watched** list.
- Add a short personal note per title (talking points, who recommended it, thoughts).
- Give a personal rating out of 10 per title.
- Move a title between lists (want → watched) without losing its note or rating.

## 3. Stack

- **Framework:** Next.js (App Router, TypeScript) — handles both UI and server-side API routes.
- **Styling:** Tailwind CSS (mobile-first).
- **ORM:** Prisma.
- **Database:** Neon (serverless Postgres, free tier).
- **Hosting:** Vercel (free tier).
- **PWA:** web app manifest + icon so the app is installable ("Add to Home Screen", fullscreen).

Rationale: Next.js on Vercel is the most standard, best-documented end-to-end path,
which matters most for a first build. Neon + Prisma give a simple, type-safe data
layer with easy migrations.

## 4. Privacy

Single shared **passcode gate**. One secret is set via an environment variable.
First visit prompts for it; once entered, the device is remembered. No user accounts.
This keeps strangers who find the URL out of the owner's personal lists and notes.

## 5. Architecture & data flow

The phone/browser talks only to the owner's app. The app's own **server-side routes**
call TMDb and OMDb, so:

- API keys stay secret (never shipped to the browser).
- No browser CORS problems.

```
Search:      user types  → app → TMDb search → results
Add a title: pick result → app → TMDb (details + cast/credits + external IDs → IMDb ID)
                               → OMDb (IMDb / Rotten Tomatoes / Metacritic scores)
                               → merge → save to DB → display
View later:  served straight from the DB (no external API calls)
Refresh:     re-fetch only if data older than 30 days, or on manual "Refresh"
```

### Caching / freshness

Each title's fetched metadata is cached in the owner's own Postgres DB with a
`fetchedAt` timestamp. Views are served from the DB. Data is re-fetched only when it
is stale (older than 30 days) or on an explicit manual refresh. This keeps external
calls comfortably under OMDb's free-tier limit of 1,000 requests/day.

## 6. Data model

Single-user, and a title lives in exactly one list at a time, so a **single table**
is used. A title moves lists by flipping `status`; the `note` and `myRating` are
separate fields, so they are **never lost when moving between lists**.

### `Title`

Cached external metadata:

| Field             | Type            | Notes                                            |
|-------------------|-----------------|--------------------------------------------------|
| `id`              | string (cuid)   | Primary key                                      |
| `tmdbId`          | int             | TMDb identifier                                  |
| `mediaType`       | enum MOVIE/TV   | Movie or TV series                               |
| `imdbId`          | string?         | From TMDb external IDs; used for OMDb lookup     |
| `title`           | string          |                                                  |
| `year`            | int?            | Release/first-air year                           |
| `posterUrl`       | string?         | Full poster URL                                  |
| `overview`        | string?         | Synopsis                                         |
| `runtime`         | int?            | Minutes                                          |
| `genres`          | string[]        | **Stored structurally** (individual tags)        |
| `cast`            | Json            | **Stored structurally**: array of `{ name, character }` |
| `director`        | string?         | Where relevant (movies)                          |
| `tmdbScore`       | float?          | TMDb rating                                      |
| `imdbScore`       | string?         | From OMDb                                         |
| `rtScore`         | string?         | Rotten Tomatoes, from OMDb                        |
| `metacriticScore` | string?         | From OMDb                                         |
| `fetchedAt`       | DateTime        | For staleness / 30-day refresh check             |

User-owned fields on the same row:

| Field       | Type                | Notes                                              |
|-------------|---------------------|----------------------------------------------------|
| `status`    | enum WANT/WATCHED   | Which list the title is on                         |
| `note`      | string?             | Personal note; preserved across list moves         |
| `myRating`  | int? (0–10)         | Owner's own score; editable; shown on detail; preserved across moves |
| `addedAt`   | DateTime            | When first added                                    |
| `watchedAt` | DateTime?           | Set when moved to WATCHED                            |

Unique constraint on (`tmdbId`, `mediaType`) so the same title isn't added twice.

> **Structured storage note:** `genres` is a Postgres text array and `cast` is JSON
> (array of objects), so the UI renders individual genre tags and individual cast
> names/characters rather than a single flattened string.

## 7. Screens (mobile-first)

1. **Passcode gate** — enter the shared secret once; remembered on the device.
2. **Home** — toggle between "Want to watch" and "Watched"; a list of poster cards;
   a search entry point.
3. **Search results** — poster + title + year for each TMDb match.
4. **Detail view** — poster, title, year, genres (as tags), runtime, synopsis,
   cast (individual names/characters), director, and all ratings: TMDb, IMDb,
   Rotten Tomatoes, Metacritic, plus the owner's **`myRating` (editable, prominent)**.
   Editable **note**. Actions: *Add to Want*, *Add to Watched*, *Move to other list*,
   *Refresh*, *Remove*.
5. **PWA install** — manifest + icon so "Add to Home Screen" launches fullscreen.

## 8. API routes (server-side)

| Route                          | Method | Purpose                                             |
|--------------------------------|--------|-----------------------------------------------------|
| `/api/auth`                    | POST   | Verify passcode, set the remembered session         |
| `/api/search?q=`               | GET    | Proxy TMDb multi-search                             |
| `/api/titles`                  | GET    | List titles, filterable by `status`                |
| `/api/titles`                  | POST   | Add a title by `tmdbId` (fetch → merge → save)     |
| `/api/titles/:id`              | PATCH  | Update `status`, `note`, and/or `myRating`         |
| `/api/titles/:id/refresh`      | POST   | Force re-fetch of external data                    |
| `/api/titles/:id`              | DELETE | Remove a title                                     |

All routes sit behind the passcode gate.

## 9. Error handling

- External API failures (TMDb/OMDb down, rate-limited, missing IMDb ID) degrade
  gracefully: save whatever data is available; missing scores show as "N/A" rather
  than blocking the add.
- A title with no IMDb ID still saves with TMDb data only (OMDb scores omitted).
- Manual refresh surfaces a clear error if the external call fails, and keeps the
  previously cached data.
- Passcode failures show a simple "incorrect passcode" message.

## 10. Secrets & configuration (environment variables)

- `TMDB_API_KEY`
- `OMDB_API_KEY`
- `APP_PASSCODE`
- `DATABASE_URL` (Neon connection string)

All secrets are read from environment variables — never hardcoded, never committed.
`.gitignore` excludes `.env*` and `node_modules`.

## 11. Scope

**In v1:** two lists, search, detail view, notes, personal rating, move-between-lists,
caching/refresh, passcode gate, PWA install.

**Deferred (not v1):** one-time import of existing Google watch history from a Google
Takeout export to backfill the watched list.

## 12. Build phases

- **Phase 0 — Prereqs:** obtain TMDb key, obtain OMDb key, create free Neon DB,
  create Vercel project (owner + assistant, with copy-paste steps).
- **Phase 1 — Scaffold:** Next.js + TypeScript + Tailwind, `git init`, env-var setup,
  `.gitignore`.
- **Phase 2 — Database:** Prisma schema + first migration against Neon.
- **Phase 3 — External APIs:** TMDb + OMDb server modules with merge logic.
- **Phase 4 — API routes + caching:** search, add, list, update (note/status/myRating),
  refresh, remove.
- **Phase 5 — UI:** the five screens, mobile-first.
- **Phase 6 — Passcode gate.**
- **Phase 7 — PWA:** manifest + icon.
- **Phase 8 — Deploy & verify:** push to Vercel, set env vars, smoke-test on a real phone.
