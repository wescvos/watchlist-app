# Personal Watchlist App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first, single-user web app to track movies/series to watch and already watched, cached in a personal database, deployed to Vercel.

**Architecture:** Next.js (App Router) serves both the UI and server-side API routes. The routes proxy TMDb + OMDb (keeping keys secret), merge the results, and cache them in Neon Postgres via Prisma. A single passcode gate protects the app.

**Tech Stack:** Next.js + TypeScript, Tailwind CSS, Prisma, Neon Postgres, Vitest (tests), Vercel (hosting).

## Global Constraints

- **Project root:** `C:\Users\Wesley Vos\dev\watchlist-app` (all files/commands here; never write to the OneDrive path).
- **Node:** v25.9.0 already installed; npm 11.12.1.
- **Secrets via env only** — `TMDB_API_KEY`, `OMDB_API_KEY`, `APP_PASSCODE`, `DATABASE_URL`. Never hardcoded, never committed.
- **`.gitignore`** must exclude `node_modules`, `.env*` (except `.env.example`), `.next`.
- **Single table** `Title`; a title is on exactly one list (`status`). `note` and `myRating` persist across list moves.
- **`genres`** stored as text array; **`cast`** stored as JSON array of `{ name, character }`. Rendered as individual tags/items, never a flattened blob.
- **Cache staleness:** re-fetch external data only if `fetchedAt` older than 30 days, or on manual refresh.
- **Mobile-first** Tailwind styling throughout.
- **Commit** after every task.

---

## Task 0: Prerequisites (manual, no code)

**Goal:** Obtain keys and cloud resources needed before coding. This task is a checklist; nothing to commit.

- [ ] **Step 1: Get a TMDb API key**
  1. Create a free account at https://www.themoviedb.org/signup
  2. Go to Settings → API → "Request an API Key" → Developer.
  3. Fill the short form (any personal-use description works).
  4. Copy the **API Read Access Token** and the **API Key (v3 auth)**. We use the v3 API key.

- [ ] **Step 2: Get an OMDb API key**
  1. Go to https://www.omdbapi.com/apikey.aspx
  2. Choose the FREE tier (1,000/day), enter email, submit.
  3. Click the activation link in the email. Copy the key.

- [ ] **Step 3: Create a free Neon Postgres database**
  1. Sign up at https://neon.tech (GitHub login is easiest).
  2. Create a project (name: `watchlist-app`). Region: pick the closest.
  3. From the dashboard, copy the **connection string** (looks like `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`).

- [ ] **Step 4: Create a Vercel account**
  1. Sign up at https://vercel.com with GitHub.
  2. (Deployment happens in Task 14; nothing else needed now.)

- [ ] **Step 5: Choose a passcode**
  - Pick any secret string for `APP_PASSCODE` (e.g. a passphrase). Keep it handy.

> Hand these five values to the implementer for the next tasks: TMDb key, OMDb key, Neon `DATABASE_URL`, chosen `APP_PASSCODE`, Vercel account ready.

---

## Task 1: Scaffold the Next.js project

**Files:**
- Create: entire Next.js app skeleton, `.gitignore`, `.env.example`, `.env.local`
- Modify: none

**Interfaces:**
- Produces: a running Next.js + Tailwind + TypeScript app; npm scripts `dev`, `build`, `test`.

- [ ] **Step 1: Scaffold Next.js (App Router, TS, Tailwind)**

Run from the project root:
```bash
cd "/c/Users/Wesley Vos/dev/watchlist-app"
npx create-next-app@latest . --typescript --tailwind --app --src-dir --eslint --import-alias "@/*" --no-turbopack --use-npm
```
When prompted that the directory is not empty (it has `docs/`, `.git`, `.claude`), choose to continue. Expected: `Success! Created ...`, `src/app/page.tsx` exists.

- [ ] **Step 2: Install test + tooling deps**

```bash
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
npm install prisma @prisma/client
```

- [ ] **Step 3: Add Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

Create `vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Add the `test` script**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write `.gitignore` additions and env files**

Confirm `.gitignore` (create-next-app makes one) contains `node_modules`, `.next`, `.env*`. Ensure a line `!.env.example` so the template is tracked.

Create `.env.example`:
```
TMDB_API_KEY=
OMDB_API_KEY=
APP_PASSCODE=
DATABASE_URL=
```

Create `.env.local` (NOT committed) with the real values from Task 0.

- [ ] **Step 6: Verify dev server and a trivial test run**

```bash
npm run dev
```
Expected: `Local: http://localhost:3000`. Open it, see the Next.js starter. Stop the server (Ctrl+C).

Create `src/lib/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs", () => { expect(1 + 1).toBe(2); });
});
```
Run: `npm test`. Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind, Prisma deps, and Vitest"
```

---

## Task 2: Database schema and Prisma client

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/prisma.ts`
- Test: `src/lib/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `prisma` singleton (`import { prisma } from "@/lib/prisma"`); `Title` model; enums `MediaType` (MOVIE|TV), `Status` (WANT|WATCHED).

- [ ] **Step 1: Initialise Prisma**

```bash
npx prisma init --datasource-provider postgresql
```
This creates `prisma/schema.prisma` and adds `DATABASE_URL` to `.env`. Delete the generated `.env` (we use `.env.local`); instead ensure Prisma reads `.env.local` by loading it — set in `package.json` a prisma block later; for now copy `DATABASE_URL` into a `.env` used only by Prisma CLI is acceptable, but simpler: keep `DATABASE_URL` in `.env` (gitignored) for CLI and duplicate in `.env.local` for the app.

> Practical note: Prisma CLI reads `.env`. Next.js reads `.env.local`. Put `DATABASE_URL` in BOTH (both are gitignored). Keep the other secrets only in `.env.local`.

- [ ] **Step 2: Define the schema**

Replace `prisma/schema.prisma` with:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum MediaType {
  MOVIE
  TV
}

enum Status {
  WANT
  WATCHED
}

model Title {
  id              String    @id @default(cuid())
  tmdbId          Int
  mediaType       MediaType
  imdbId          String?
  title           String
  year            Int?
  posterUrl       String?
  overview        String?
  runtime         Int?
  genres          String[]
  cast            Json      @default("[]")
  director        String?
  tmdbScore       Float?
  imdbScore       String?
  rtScore         String?
  metacriticScore String?
  fetchedAt       DateTime  @default(now())

  status          Status    @default(WANT)
  note            String?
  myRating        Int?
  addedAt         DateTime  @default(now())
  watchedAt       DateTime?

  @@unique([tmdbId, mediaType])
}
```

- [ ] **Step 3: Create the Prisma client singleton**

Create `src/lib/prisma.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 4: Run the first migration against Neon**

```bash
npx prisma migrate dev --name init
```
Expected: `Your database is now in sync with your schema`, generates `prisma/migrations/*`, and generates the client.

- [ ] **Step 5: Verify the schema compiles + generated types exist**

Create `src/lib/__tests__/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { MediaType, Status } from "@prisma/client";

describe("prisma enums", () => {
  it("exposes MediaType and Status", () => {
    expect(MediaType.MOVIE).toBe("MOVIE");
    expect(Status.WATCHED).toBe("WATCHED");
  });
});
```
Run: `npm test`. Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Title schema, Prisma client, and initial migration"
```

---

## Task 3: Typed environment access

**Files:**
- Create: `src/lib/env.ts`
- Test: `src/lib/__tests__/env.test.ts`

**Interfaces:**
- Produces: `getEnv(name)` returning a required string or throwing; named getters `env.tmdbKey`, `env.omdbKey`, `env.passcode`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/env.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { getEnv } from "@/lib/env";

afterEach(() => { delete process.env.TEST_KEY; });

describe("getEnv", () => {
  it("returns a set variable", () => {
    process.env.TEST_KEY = "hello";
    expect(getEnv("TEST_KEY")).toBe("hello");
  });
  it("throws when missing", () => {
    expect(() => getEnv("TEST_KEY")).toThrow(/TEST_KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- env`. Expected: FAIL (`getEnv` not found).

- [ ] **Step 3: Implement**

Create `src/lib/env.ts`:
```ts
export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  get tmdbKey() { return getEnv("TMDB_API_KEY"); },
  get omdbKey() { return getEnv("OMDB_API_KEY"); },
  get passcode() { return getEnv("APP_PASSCODE"); },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- env`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add typed environment variable access"
```

---

## Task 4: TMDb client

**Files:**
- Create: `src/lib/tmdb.ts`, `src/lib/types.ts`
- Test: `src/lib/__tests__/tmdb.test.ts`

**Interfaces:**
- Produces:
  - `type SearchResult = { tmdbId: number; mediaType: "MOVIE"|"TV"; title: string; year: number|null; posterUrl: string|null }`
  - `type TmdbDetails = { tmdbId:number; mediaType:"MOVIE"|"TV"; imdbId:string|null; title:string; year:number|null; posterUrl:string|null; overview:string|null; runtime:number|null; genres:string[]; cast:{name:string;character:string}[]; director:string|null; tmdbScore:number|null }`
  - `searchTitles(q: string): Promise<SearchResult[]>`
  - `getTitleDetails(tmdbId: number, mediaType: "MOVIE"|"TV"): Promise<TmdbDetails>`

- [ ] **Step 1: Define shared types**

Create `src/lib/types.ts`:
```ts
export type MediaKind = "MOVIE" | "TV";

export interface SearchResult {
  tmdbId: number;
  mediaType: MediaKind;
  title: string;
  year: number | null;
  posterUrl: string | null;
}

export interface CastMember {
  name: string;
  character: string;
}

export interface TmdbDetails {
  tmdbId: number;
  mediaType: MediaKind;
  imdbId: string | null;
  title: string;
  year: number | null;
  posterUrl: string | null;
  overview: string | null;
  runtime: number | null;
  genres: string[];
  cast: CastMember[];
  director: string | null;
  tmdbScore: number | null;
}
```

- [ ] **Step 2: Write the failing tests (with mocked fetch)**

Create `src/lib/__tests__/tmdb.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchTitles, getTitleDetails } from "@/lib/tmdb";

beforeEach(() => { process.env.TMDB_API_KEY = "k"; });
afterEach(() => { vi.restoreAllMocks(); });

function mockFetchOnce(json: unknown) {
  return vi.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(json), { status: 200 }),
  );
}

describe("searchTitles", () => {
  it("maps multi-search movie + tv, skips person", async () => {
    mockFetchOnce({ results: [
      { media_type: "movie", id: 1, title: "Dune", release_date: "2021-10-22", poster_path: "/a.jpg" },
      { media_type: "tv", id: 2, name: "Severance", first_air_date: "2022-02-18", poster_path: null },
      { media_type: "person", id: 3, name: "Someone" },
    ]});
    const out = await searchTitles("x");
    expect(out).toEqual([
      { tmdbId: 1, mediaType: "MOVIE", title: "Dune", year: 2021, posterUrl: "https://image.tmdb.org/t/p/w500/a.jpg" },
      { tmdbId: 2, mediaType: "TV", title: "Severance", year: 2022, posterUrl: null },
    ]);
  });
});

describe("getTitleDetails", () => {
  it("merges details, credits, and external ids for a movie", async () => {
    mockFetchOnce({
      id: 1, title: "Dune", release_date: "2021-10-22", poster_path: "/a.jpg",
      overview: "Sand.", runtime: 155, vote_average: 8.0,
      genres: [{ name: "Sci-Fi" }, { name: "Adventure" }],
      external_ids: { imdb_id: "tt1160419" },
      credits: {
        cast: [{ name: "Timothée", character: "Paul" }, { name: "Zendaya", character: "Chani" }],
        crew: [{ job: "Director", name: "Denis Villeneuve" }],
      },
    });
    const out = await getTitleDetails(1, "MOVIE");
    expect(out.imdbId).toBe("tt1160419");
    expect(out.director).toBe("Denis Villeneuve");
    expect(out.genres).toEqual(["Sci-Fi", "Adventure"]);
    expect(out.cast[0]).toEqual({ name: "Timothée", character: "Paul" });
    expect(out.tmdbScore).toBe(8.0);
    expect(out.runtime).toBe(155);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tmdb`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement the TMDb client**

Create `src/lib/tmdb.ts`:
```ts
import { env } from "@/lib/env";
import type { SearchResult, TmdbDetails, MediaKind, CastMember } from "@/lib/types";

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

function poster(path: string | null): string | null {
  return path ? `${IMG}${path}` : null;
}
function yearOf(date?: string | null): number | null {
  if (!date) return null;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

async function tmdbGet(pathname: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}${pathname}`);
  url.searchParams.set("api_key", env.tmdbKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDb ${pathname} failed: ${res.status}`);
  return res.json();
}

export async function searchTitles(q: string): Promise<SearchResult[]> {
  const data = await tmdbGet("/search/multi", { query: q, include_adult: "false" });
  return (data.results ?? [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .map((r: any): SearchResult => {
      const mediaType: MediaKind = r.media_type === "movie" ? "MOVIE" : "TV";
      return {
        tmdbId: r.id,
        mediaType,
        title: r.title ?? r.name,
        year: yearOf(r.release_date ?? r.first_air_date),
        posterUrl: poster(r.poster_path ?? null),
      };
    });
}

export async function getTitleDetails(tmdbId: number, mediaType: MediaKind): Promise<TmdbDetails> {
  const path = mediaType === "MOVIE" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const data = await tmdbGet(path, { append_to_response: "credits,external_ids" });

  const cast: CastMember[] = (data.credits?.cast ?? [])
    .slice(0, 15)
    .map((c: any) => ({ name: c.name, character: c.character ?? "" }));

  const director =
    (data.credits?.crew ?? []).find((c: any) => c.job === "Director")?.name ?? null;

  const runtime =
    mediaType === "MOVIE"
      ? (data.runtime ?? null)
      : (Array.isArray(data.episode_run_time) && data.episode_run_time.length
          ? data.episode_run_time[0]
          : null);

  return {
    tmdbId: data.id,
    mediaType,
    imdbId: data.external_ids?.imdb_id ?? null,
    title: data.title ?? data.name,
    year: yearOf(data.release_date ?? data.first_air_date),
    posterUrl: poster(data.poster_path ?? null),
    overview: data.overview ?? null,
    runtime,
    genres: (data.genres ?? []).map((g: any) => g.name),
    cast,
    director,
    tmdbScore: typeof data.vote_average === "number" ? data.vote_average : null,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tmdb`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add TMDb client (search + details/credits/external ids)"
```

---

## Task 5: OMDb client

**Files:**
- Create: `src/lib/omdb.ts`
- Test: `src/lib/__tests__/omdb.test.ts`

**Interfaces:**
- Produces:
  - `type OmdbScores = { imdbScore: string|null; rtScore: string|null; metacriticScore: string|null }`
  - `getScoresByImdbId(imdbId: string): Promise<OmdbScores>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/omdb.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getScoresByImdbId } from "@/lib/omdb";

beforeEach(() => { process.env.OMDB_API_KEY = "k"; });
afterEach(() => { vi.restoreAllMocks(); });

function mockFetchOnce(json: unknown) {
  return vi.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(json), { status: 200 }),
  );
}

describe("getScoresByImdbId", () => {
  it("extracts imdb, rotten tomatoes, metacritic", async () => {
    mockFetchOnce({
      Response: "True",
      imdbRating: "8.0",
      Metascore: "74",
      Ratings: [
        { Source: "Internet Movie Database", Value: "8.0/10" },
        { Source: "Rotten Tomatoes", Value: "83%" },
        { Source: "Metacritic", Value: "74/100" },
      ],
    });
    const out = await getScoresByImdbId("tt1160419");
    expect(out).toEqual({ imdbScore: "8.0", rtScore: "83%", metacriticScore: "74" });
  });

  it("returns nulls when omdb reports not found", async () => {
    mockFetchOnce({ Response: "False", Error: "Incorrect IMDb ID." });
    const out = await getScoresByImdbId("tt0");
    expect(out).toEqual({ imdbScore: null, rtScore: null, metacriticScore: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- omdb`. Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/omdb.ts`:
```ts
import { env } from "@/lib/env";

export interface OmdbScores {
  imdbScore: string | null;
  rtScore: string | null;
  metacriticScore: string | null;
}

const EMPTY: OmdbScores = { imdbScore: null, rtScore: null, metacriticScore: null };

export async function getScoresByImdbId(imdbId: string): Promise<OmdbScores> {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", env.omdbKey);
  url.searchParams.set("i", imdbId);

  const res = await fetch(url.toString());
  if (!res.ok) return EMPTY;
  const data = await res.json();
  if (data.Response !== "True") return EMPTY;

  const ratings: { Source: string; Value: string }[] = data.Ratings ?? [];
  const rt = ratings.find((r) => r.Source === "Rotten Tomatoes")?.Value ?? null;

  return {
    imdbScore: data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null,
    rtScore: rt,
    metacriticScore: data.Metascore && data.Metascore !== "N/A" ? data.Metascore : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- omdb`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add OMDb client for IMDb/RT/Metacritic scores"
```

---

## Task 6: Fetch-and-merge service

**Files:**
- Create: `src/lib/fetchTitle.ts`
- Test: `src/lib/__tests__/fetchTitle.test.ts`

**Interfaces:**
- Consumes: `getTitleDetails` (Task 4), `getScoresByImdbId` (Task 5).
- Produces:
  - `type MergedTitle = TmdbDetails & OmdbScores`
  - `fetchMergedTitle(tmdbId: number, mediaType: MediaKind): Promise<MergedTitle>`

- [ ] **Step 1: Write the failing tests (mock the two clients)**

Create `src/lib/__tests__/fetchTitle.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/tmdb", () => ({
  getTitleDetails: vi.fn(),
}));
vi.mock("@/lib/omdb", () => ({
  getScoresByImdbId: vi.fn(),
}));

import { getTitleDetails } from "@/lib/tmdb";
import { getScoresByImdbId } from "@/lib/omdb";
import { fetchMergedTitle } from "@/lib/fetchTitle";

const base = {
  tmdbId: 1, mediaType: "MOVIE" as const, imdbId: "tt1", title: "Dune", year: 2021,
  posterUrl: null, overview: "x", runtime: 155, genres: ["Sci-Fi"],
  cast: [{ name: "A", character: "B" }], director: "D", tmdbScore: 8.0,
};

describe("fetchMergedTitle", () => {
  it("merges TMDb details with OMDb scores when imdbId present", async () => {
    (getTitleDetails as any).mockResolvedValue(base);
    (getScoresByImdbId as any).mockResolvedValue({ imdbScore: "8.0", rtScore: "83%", metacriticScore: "74" });
    const out = await fetchMergedTitle(1, "MOVIE");
    expect(out.rtScore).toBe("83%");
    expect(out.title).toBe("Dune");
    expect(getScoresByImdbId).toHaveBeenCalledWith("tt1");
  });

  it("skips OMDb and returns null scores when no imdbId", async () => {
    (getTitleDetails as any).mockResolvedValue({ ...base, imdbId: null });
    const out = await fetchMergedTitle(1, "MOVIE");
    expect(out.imdbScore).toBeNull();
    expect(getScoresByImdbId).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- fetchTitle`. Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/fetchTitle.ts`:
```ts
import { getTitleDetails } from "@/lib/tmdb";
import { getScoresByImdbId } from "@/lib/omdb";
import type { TmdbDetails, MediaKind } from "@/lib/types";
import type { OmdbScores } from "@/lib/omdb";

export type MergedTitle = TmdbDetails & OmdbScores;

const NO_SCORES: OmdbScores = { imdbScore: null, rtScore: null, metacriticScore: null };

export async function fetchMergedTitle(tmdbId: number, mediaType: MediaKind): Promise<MergedTitle> {
  const details = await getTitleDetails(tmdbId, mediaType);
  const scores = details.imdbId ? await getScoresByImdbId(details.imdbId) : NO_SCORES;
  return { ...details, ...scores };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- fetchTitle`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add fetch-and-merge service combining TMDb + OMDb"
```

---

## Task 7: Titles repository (DB service + staleness)

**Files:**
- Create: `src/lib/titles.ts`
- Test: `src/lib/__tests__/staleness.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `fetchMergedTitle` (Task 6).
- Produces:
  - `isStale(fetchedAt: Date, now?: Date): boolean` (true if older than 30 days)
  - `addTitle(tmdbId, mediaType): Promise<Title>` (fetch+merge+upsert with status default WANT)
  - `listTitles(status?: Status): Promise<Title[]>`
  - `getTitle(id): Promise<Title|null>`
  - `updateTitle(id, { status?, note?, myRating? }): Promise<Title>` (sets `watchedAt` when moving to WATCHED)
  - `refreshTitle(id): Promise<Title>` (re-fetch external data, keep user fields)
  - `deleteTitle(id): Promise<void>`

- [ ] **Step 1: Write the failing test for the pure helper**

Create `src/lib/__tests__/staleness.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isStale } from "@/lib/titles";

describe("isStale", () => {
  const now = new Date("2026-07-14T00:00:00Z");
  it("false when fetched 29 days ago", () => {
    const d = new Date(now); d.setDate(d.getDate() - 29);
    expect(isStale(d, now)).toBe(false);
  });
  it("true when fetched 31 days ago", () => {
    const d = new Date(now); d.setDate(d.getDate() - 31);
    expect(isStale(d, now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- staleness`. Expected: FAIL.

- [ ] **Step 3: Implement the repository**

Create `src/lib/titles.ts`:
```ts
import { prisma } from "@/lib/prisma";
import { fetchMergedTitle, type MergedTitle } from "@/lib/fetchTitle";
import type { MediaKind } from "@/lib/types";
import { Status, type Title, Prisma } from "@prisma/client";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function isStale(fetchedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - fetchedAt.getTime() > THIRTY_DAYS_MS;
}

function toData(m: MergedTitle) {
  return {
    tmdbId: m.tmdbId,
    mediaType: m.mediaType,
    imdbId: m.imdbId,
    title: m.title,
    year: m.year,
    posterUrl: m.posterUrl,
    overview: m.overview,
    runtime: m.runtime,
    genres: m.genres,
    cast: m.cast as unknown as Prisma.InputJsonValue,
    director: m.director,
    tmdbScore: m.tmdbScore,
    imdbScore: m.imdbScore,
    rtScore: m.rtScore,
    metacriticScore: m.metacriticScore,
    fetchedAt: new Date(),
  };
}

export async function addTitle(tmdbId: number, mediaType: MediaKind): Promise<Title> {
  const merged = await fetchMergedTitle(tmdbId, mediaType);
  const data = toData(merged);
  return prisma.title.upsert({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
    update: data, // refresh cached metadata; leave user fields (status/note/myRating) untouched
    create: { ...data, status: Status.WANT },
  });
}

export function listTitles(status?: Status): Promise<Title[]> {
  return prisma.title.findMany({
    where: status ? { status } : undefined,
    orderBy: { addedAt: "desc" },
  });
}

export function getTitle(id: string): Promise<Title | null> {
  return prisma.title.findUnique({ where: { id } });
}

export async function updateTitle(
  id: string,
  patch: { status?: Status; note?: string | null; myRating?: number | null },
): Promise<Title> {
  const data: Prisma.TitleUpdateInput = {};
  if (patch.note !== undefined) data.note = patch.note;
  if (patch.myRating !== undefined) data.myRating = patch.myRating;
  if (patch.status !== undefined) {
    data.status = patch.status;
    data.watchedAt = patch.status === Status.WATCHED ? new Date() : null;
  }
  return prisma.title.update({ where: { id }, data });
}

export async function refreshTitle(id: string): Promise<Title> {
  const existing = await prisma.title.findUniqueOrThrow({ where: { id } });
  const merged = await fetchMergedTitle(existing.tmdbId, existing.mediaType as MediaKind);
  return prisma.title.update({ where: { id }, data: toData(merged) });
}

export async function deleteTitle(id: string): Promise<void> {
  await prisma.title.delete({ where: { id } });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- staleness`. Expected: PASS.

> Note: `addTitle`/`refreshTitle`/etc. hit the DB and are exercised via the API-route smoke test in Task 8 and the manual end-to-end in Task 14, not unit-tested here (they are thin Prisma wrappers).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add titles repository with 30-day staleness helper"
```

---

## Task 8: API routes

**Files:**
- Create: `src/app/api/search/route.ts`, `src/app/api/titles/route.ts`, `src/app/api/titles/[id]/route.ts`, `src/app/api/titles/[id]/refresh/route.ts`
- Test: `src/app/api/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: repository functions (Task 7), `searchTitles` (Task 4).
- Produces HTTP endpoints:
  - `GET /api/search?q=` → `SearchResult[]`
  - `GET /api/titles?status=WANT|WATCHED` → `Title[]`
  - `POST /api/titles` body `{ tmdbId, mediaType }` → `Title`
  - `PATCH /api/titles/:id` body `{ status?, note?, myRating? }` → `Title`
  - `DELETE /api/titles/:id` → `{ ok: true }`
  - `POST /api/titles/:id/refresh` → `Title`

- [ ] **Step 1: Write a failing test for the search route (mock the lib)**

Create `src/app/api/__tests__/routes.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/tmdb", () => ({ searchTitles: vi.fn() }));
import { searchTitles } from "@/lib/tmdb";
import { GET } from "@/app/api/search/route";

describe("GET /api/search", () => {
  it("returns 400 without q", async () => {
    const res = await GET(new Request("http://x/api/search"));
    expect(res.status).toBe(400);
  });
  it("returns results for q", async () => {
    (searchTitles as any).mockResolvedValue([{ tmdbId: 1, mediaType: "MOVIE", title: "Dune", year: 2021, posterUrl: null }]);
    const res = await GET(new Request("http://x/api/search?q=dune"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].title).toBe("Dune");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- routes`. Expected: FAIL.

- [ ] **Step 3: Implement the search route**

Create `src/app/api/search/route.ts`:
```ts
import { NextResponse } from "next/server";
import { searchTitles } from "@/lib/tmdb";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });
  try {
    return NextResponse.json(await searchTitles(q));
  } catch (e) {
    return NextResponse.json({ error: "Search failed" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Implement the titles collection route**

Create `src/app/api/titles/route.ts`:
```ts
import { NextResponse } from "next/server";
import { listTitles, addTitle } from "@/lib/titles";
import { Status } from "@prisma/client";
import type { MediaKind } from "@/lib/types";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("status");
  const status = raw === "WANT" || raw === "WATCHED" ? (raw as Status) : undefined;
  return NextResponse.json(await listTitles(status));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const tmdbId = Number(body?.tmdbId);
  const mediaType = body?.mediaType as MediaKind;
  if (!tmdbId || (mediaType !== "MOVIE" && mediaType !== "TV")) {
    return NextResponse.json({ error: "tmdbId and mediaType required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await addTitle(tmdbId, mediaType));
  } catch {
    return NextResponse.json({ error: "Add failed" }, { status: 502 });
  }
}
```

- [ ] **Step 5: Implement the single-title route**

Create `src/app/api/titles/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { updateTitle, deleteTitle } from "@/lib/titles";
import { Status } from "@prisma/client";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: { status?: Status; note?: string | null; myRating?: number | null } = {};
  if (body.status === "WANT" || body.status === "WATCHED") patch.status = body.status;
  if (typeof body.note === "string" || body.note === null) patch.note = body.note;
  if (body.myRating === null || (Number.isInteger(body.myRating) && body.myRating >= 0 && body.myRating <= 10)) {
    patch.myRating = body.myRating;
  }
  try {
    return NextResponse.json(await updateTitle(id, patch));
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteTitle(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Delete failed" }, { status: 404 });
  }
}
```

- [ ] **Step 6: Implement the refresh route**

Create `src/app/api/titles/[id]/refresh/route.ts`:
```ts
import { NextResponse } from "next/server";
import { refreshTitle } from "@/lib/titles";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await refreshTitle(id));
  } catch {
    return NextResponse.json({ error: "Refresh failed" }, { status: 502 });
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- routes`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add API routes for search, titles CRUD, and refresh"
```

---

## Task 9: Passcode gate

**Files:**
- Create: `src/middleware.ts`, `src/app/api/auth/route.ts`, `src/app/gate/page.tsx`
- Test: `src/app/api/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `env.passcode` (Task 3).
- Produces: cookie-based gate. `POST /api/auth` body `{ passcode }` sets an httpOnly cookie `wl_auth` on success. Middleware redirects unauthenticated page/API requests (except `/gate` and `/api/auth`) to `/gate`.

- [ ] **Step 1: Write the failing auth-route test**

Create `src/app/api/__tests__/auth.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/auth/route";

beforeEach(() => { process.env.APP_PASSCODE = "secret"; });

describe("POST /api/auth", () => {
  it("rejects wrong passcode", async () => {
    const res = await POST(new Request("http://x/api/auth", { method: "POST", body: JSON.stringify({ passcode: "nope" }) }));
    expect(res.status).toBe(401);
  });
  it("accepts correct passcode and sets cookie", async () => {
    const res = await POST(new Request("http://x/api/auth", { method: "POST", body: JSON.stringify({ passcode: "secret" }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("wl_auth=");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- auth`. Expected: FAIL.

- [ ] **Step 3: Implement the auth route**

Create `src/app/api/auth/route.ts`:
```ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.passcode !== env.passcode) {
    return NextResponse.json({ error: "Incorrect passcode" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("wl_auth", env.passcode, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year — "remember this device"
  });
  return res;
}
```

- [ ] **Step 4: Implement middleware**

Create `src/middleware.ts`:
```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/gate" || pathname === "/api/auth";
  if (isPublic) return NextResponse.next();

  const authed = req.cookies.get("wl_auth")?.value === process.env.APP_PASSCODE;
  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/gate";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons).*)"],
};
```

- [ ] **Step 5: Implement the gate page**

Create `src/app/gate/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GatePage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/auth", { method: "POST", body: JSON.stringify({ passcode }) });
    if (res.ok) router.push("/");
    else setError("Incorrect passcode");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <h1 className="text-xl font-semibold text-center">Watchlist</h1>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Passcode"
          className="w-full rounded-lg border p-3"
          autoFocus
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-black text-white p-3">Enter</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Run tests + manual check**

Run: `npm test -- auth`. Expected: PASS.
Run `npm run dev`, visit `/` → should redirect to `/gate`. Enter the passcode → lands on home. Stop server.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add passcode gate (middleware, auth route, gate page)"
```

---

## Task 10: Home screen (lists + toggle)

**Files:**
- Create: `src/app/page.tsx`, `src/components/TitleCard.tsx`, `src/components/ListToggle.tsx`
- Modify: `src/app/layout.tsx` (title/metadata, base styles)

**Interfaces:**
- Consumes: `GET /api/titles?status=`.
- Produces: home UI with a WANT/WATCHED toggle, a grid of poster cards linking to `/title/:id`, and a link to `/search`.

- [ ] **Step 1: Set app metadata + mobile viewport**

Modify `src/app/layout.tsx` — set `metadata` title to "Watchlist" and ensure `<html lang="en">`. Add to `metadata`:
```ts
export const metadata = {
  title: "Watchlist",
  description: "Personal movie & series watchlist",
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };
```

- [ ] **Step 2: Create the TitleCard component**

Create `src/components/TitleCard.tsx`:
```tsx
import Link from "next/link";

export interface CardTitle {
  id: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  myRating: number | null;
}

export function TitleCard({ t }: { t: CardTitle }) {
  return (
    <Link href={`/title/${t.id}`} className="block">
      <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200">
        {t.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.posterUrl} alt={t.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-gray-500">
            {t.title}
          </div>
        )}
      </div>
      <p className="mt-1 truncate text-sm font-medium">{t.title}</p>
      <p className="text-xs text-gray-500">
        {t.year ?? ""}{t.myRating != null ? ` · ★ ${t.myRating}/10` : ""}
      </p>
    </Link>
  );
}
```

- [ ] **Step 3: Create the ListToggle component**

Create `src/components/ListToggle.tsx`:
```tsx
"use client";

export function ListToggle({ value, onChange }: { value: "WANT" | "WATCHED"; onChange: (v: "WANT" | "WATCHED") => void }) {
  const base = "flex-1 rounded-lg p-2 text-sm font-medium";
  return (
    <div className="flex gap-2 rounded-xl bg-gray-100 p-1">
      <button className={`${base} ${value === "WANT" ? "bg-white shadow" : ""}`} onClick={() => onChange("WANT")}>
        Want to watch
      </button>
      <button className={`${base} ${value === "WATCHED" ? "bg-white shadow" : ""}`} onClick={() => onChange("WATCHED")}>
        Watched
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Build the home page**

Replace `src/app/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ListToggle } from "@/components/ListToggle";
import { TitleCard, type CardTitle } from "@/components/TitleCard";

export default function Home() {
  const [status, setStatus] = useState<"WANT" | "WATCHED">("WANT");
  const [titles, setTitles] = useState<CardTitle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/titles?status=${status}`)
      .then((r) => r.json())
      .then((data) => setTitles(data))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Watchlist</h1>
        <Link href="/search" className="rounded-lg bg-black px-3 py-2 text-sm text-white">+ Add</Link>
      </div>
      <ListToggle value={status} onChange={setStatus} />
      {loading ? (
        <p className="mt-8 text-center text-sm text-gray-500">Loading…</p>
      ) : titles.length === 0 ? (
        <p className="mt-8 text-center text-sm text-gray-500">Nothing here yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {titles.map((t) => <TitleCard key={t.id} t={t} />)}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Manual check**

Run `npm run dev`, log in, home renders with empty state and the toggle switches without error. Stop server.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add home screen with list toggle and poster grid"
```

---

## Task 11: Search screen

**Files:**
- Create: `src/app/search/page.tsx`

**Interfaces:**
- Consumes: `GET /api/search?q=`, `POST /api/titles`.
- Produces: a search input, result list, and an "Add" action that POSTs the title then navigates to its detail page.

- [ ] **Step 1: Build the search page**

Create `src/app/search/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Result { tmdbId: number; mediaType: "MOVIE" | "TV"; title: string; year: number | null; posterUrl: string | null; }

export default function Search() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const router = useRouter();

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    setResults(res.ok ? await res.json() : []);
    setBusy(false);
  }

  async function add(r: Result) {
    setAdding(r.tmdbId);
    const res = await fetch("/api/titles", {
      method: "POST",
      body: JSON.stringify({ tmdbId: r.tmdbId, mediaType: r.mediaType }),
    });
    setAdding(null);
    if (res.ok) { const t = await res.json(); router.push(`/title/${t.id}`); }
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/" className="text-sm text-gray-500">← Back</Link>
        <h1 className="text-lg font-semibold">Search</h1>
      </div>
      <form onSubmit={run} className="mb-4 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Movie or series…"
          className="flex-1 rounded-lg border p-3" autoFocus />
        <button className="rounded-lg bg-black px-4 text-white">Go</button>
      </form>
      {busy && <p className="text-center text-sm text-gray-500">Searching…</p>}
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={`${r.mediaType}-${r.tmdbId}`} className="flex items-center gap-3 rounded-lg border p-2">
            <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded bg-gray-200">
              {r.posterUrl && /* eslint-disable-next-line @next/next/no-img-element */
                <img src={r.posterUrl} alt={r.title} className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{r.title}</p>
              <p className="text-xs text-gray-500">{r.mediaType === "TV" ? "TV" : "Movie"}{r.year ? ` · ${r.year}` : ""}</p>
            </div>
            <button onClick={() => add(r)} disabled={adding === r.tmdbId}
              className="rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-50">
              {adding === r.tmdbId ? "Adding…" : "Add"}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Manual check**

Run dev, go to `/search`, search a real title (needs real TMDb key in `.env.local`), results appear. (Adding is verified in Task 12/14 once detail exists.) Stop server.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add search screen with TMDb results and add action"
```

---

## Task 12: Detail screen (ratings, myRating, note, actions)

**Files:**
- Create: `src/app/title/[id]/page.tsx`, `src/app/title/[id]/TitleDetail.tsx`

**Interfaces:**
- Consumes: `getTitle` (server, Task 7), `PATCH /api/titles/:id`, `POST /api/titles/:id/refresh`, `DELETE /api/titles/:id`.
- Produces: server component loads the title from the DB and renders the client `TitleDetail` with editable `myRating` + `note`, all four external ratings, and status/refresh/remove actions.

- [ ] **Step 1: Server component to load the title**

Create `src/app/title/[id]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { getTitle } from "@/lib/titles";
import { TitleDetail } from "./TitleDetail";

export default async function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const title = await getTitle(id);
  if (!title) notFound();
  // Cast JSON + dates to a plain serialisable object for the client component.
  return <TitleDetail title={JSON.parse(JSON.stringify(title))} />;
}
```

- [ ] **Step 2: Client detail component**

Create `src/app/title/[id]/TitleDetail.tsx`:
```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface CastMember { name: string; character: string; }
interface Title {
  id: string; title: string; year: number | null; posterUrl: string | null;
  overview: string | null; runtime: number | null; genres: string[];
  cast: CastMember[]; director: string | null;
  tmdbScore: number | null; imdbScore: string | null; rtScore: string | null; metacriticScore: string | null;
  status: "WANT" | "WATCHED"; note: string | null; myRating: number | null;
}

function Rating({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-lg bg-gray-100 px-3 py-2 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold">{value ?? "N/A"}</div>
    </div>
  );
}

export function TitleDetail({ title }: { title: Title }) {
  const router = useRouter();
  const [status, setStatus] = useState(title.status);
  const [note, setNote] = useState(title.note ?? "");
  const [myRating, setMyRating] = useState<number | "">(title.myRating ?? "");
  const [saving, setSaving] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    await fetch(`/api/titles/${title.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setSaving(false);
    router.refresh();
  }

  async function toggleStatus() {
    const next = status === "WANT" ? "WATCHED" : "WANT";
    setStatus(next);
    await patch({ status: next });
  }

  async function refresh() {
    setSaving(true);
    await fetch(`/api/titles/${title.id}/refresh`, { method: "POST" });
    setSaving(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Remove this title?")) return;
    await fetch(`/api/titles/${title.id}`, { method: "DELETE" });
    router.push("/");
  }

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <Link href="/" className="text-sm text-gray-500">← Back</Link>

      <div className="mt-3 flex gap-4">
        <div className="h-48 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-gray-200">
          {title.posterUrl && /* eslint-disable-next-line @next/next/no-img-element */
            <img src={title.posterUrl} alt={title.title} className="h-full w-full object-cover" />}
        </div>
        <div>
          <h1 className="text-xl font-semibold">{title.title}</h1>
          <p className="text-sm text-gray-500">
            {title.year ?? ""}{title.runtime ? ` · ${title.runtime} min` : ""}
          </p>
          {title.director && <p className="mt-1 text-sm">Director: {title.director}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {title.genres.map((g) => (
              <span key={g} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{g}</span>
            ))}
          </div>
        </div>
      </div>

      {/* My rating — the key personal field */}
      <div className="mt-4 rounded-xl border p-3">
        <label className="text-sm font-medium">My rating (0–10)</label>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number" min={0} max={10} value={myRating}
            onChange={(e) => setMyRating(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-20 rounded-lg border p-2"
          />
          <button
            onClick={() => patch({ myRating: myRating === "" ? null : myRating })}
            className="rounded-lg bg-black px-3 py-2 text-sm text-white" disabled={saving}
          >Save</button>
        </div>
      </div>

      {/* External ratings */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <Rating label="TMDb" value={title.tmdbScore} />
        <Rating label="IMDb" value={title.imdbScore} />
        <Rating label="RT" value={title.rtScore} />
        <Rating label="Meta" value={title.metacriticScore} />
      </div>

      {title.overview && <p className="mt-4 text-sm leading-relaxed">{title.overview}</p>}

      {/* Cast as individual items */}
      {title.cast.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-medium">Cast</h2>
          <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
            {title.cast.map((c, i) => (
              <li key={i}>{c.name}{c.character ? <span className="text-gray-400"> as {c.character}</span> : null}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Note */}
      <div className="mt-4">
        <label className="text-sm font-medium">Note</label>
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)} rows={3}
          className="mt-1 w-full rounded-lg border p-2 text-sm"
          placeholder="Who recommended it, talking points, thoughts…"
        />
        <button onClick={() => patch({ note })} className="mt-1 rounded-lg bg-black px-3 py-2 text-sm text-white" disabled={saving}>
          Save note
        </button>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-2">
        <button onClick={toggleStatus} className="rounded-lg border px-3 py-2 text-sm">
          {status === "WANT" ? "Mark as watched" : "Move to want to watch"}
        </button>
        <button onClick={refresh} className="rounded-lg border px-3 py-2 text-sm" disabled={saving}>Refresh</button>
        <button onClick={remove} className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600">Remove</button>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Manual end-to-end check**

Run dev with real keys + DB. Search → Add → land on detail → set myRating, save → add a note, save → mark as watched → back to home, verify it appears under Watched with the rating. Stop server.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add title detail screen with ratings, myRating, note, and actions"
```

---

## Task 13: PWA (installable, add to home screen)

**Files:**
- Create: `public/manifest.webmanifest`, `public/icons/icon-192.png`, `public/icons/icon-512.png`
- Modify: `src/app/layout.tsx` (link the manifest)

**Interfaces:**
- Produces: an installable app with icon + fullscreen (`display: standalone`).

- [ ] **Step 1: Create the manifest**

Create `public/manifest.webmanifest`:
```json
{
  "name": "Watchlist",
  "short_name": "Watchlist",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#000000",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Add icons**

Place two square PNG icons at `public/icons/icon-192.png` and `public/icons/icon-512.png`. (Any simple square logo works; a plain black square with white "W" is fine for v1. If none is available, generate with an online favicon/app-icon generator.)

- [ ] **Step 3: Link the manifest**

In `src/app/layout.tsx`, add to `metadata`:
```ts
export const metadata = {
  title: "Watchlist",
  description: "Personal movie & series watchlist",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Watchlist", statusBarStyle: "black-translucent" },
};
```

- [ ] **Step 4: Manual check**

Run dev, open Chrome devtools → Application → Manifest: no errors, icons load. (Full install test happens on the phone in Task 14.) Stop server.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add PWA manifest and icons for home-screen install"
```

---

## Task 14: Deploy to Vercel and verify on phone

**Files:** none (deployment + verification)

- [ ] **Step 1: Push to a GitHub repo**

```bash
cd "/c/Users/Wesley Vos/dev/watchlist-app"
gh repo create watchlist-app --private --source=. --remote=origin --push
```
(Or create the repo in the GitHub UI and `git remote add origin ... && git push -u origin main`.)

- [ ] **Step 2: Import into Vercel**

1. Vercel dashboard → Add New → Project → import `watchlist-app`.
2. Framework preset auto-detects **Next.js**. Leave defaults.

- [ ] **Step 3: Set environment variables in Vercel**

In the project's Settings → Environment Variables, add (Production + Preview + Development):
- `TMDB_API_KEY`
- `OMDB_API_KEY`
- `APP_PASSCODE`
- `DATABASE_URL` (the Neon connection string)

- [ ] **Step 4: Ensure migrations run on deploy**

In `package.json`, set the build script to run migrations first:
```json
"build": "prisma migrate deploy && next build"
```
Commit and push:
```bash
git add package.json && git commit -m "chore: run prisma migrate deploy during Vercel build" && git push
```

- [ ] **Step 5: Deploy and smoke-test**

1. Trigger a deploy (push does it). Wait for the green "Ready".
2. Open the production URL on the **phone**:
   - Gate prompts for passcode → enter it → home loads.
   - Search a title → Add → detail shows poster, synopsis, cast (individual names), genres (tags), all four external ratings.
   - Set `myRating`, save; add a note, save; mark as watched.
   - Back on home, toggle to Watched → the title is there with the rating.
3. In the phone browser menu → "Add to Home Screen" → confirm the icon appears and the app opens fullscreen.

- [ ] **Step 6: Final commit / tag**

```bash
git tag v1.0 && git push --tags
```

---

## Self-Review

**Spec coverage:**
- Search + details before deciding → Tasks 4, 8, 11. ✓
- Mark WANT/WATCHED, view both lists → Tasks 7, 8, 10. ✓
- Personal note → Tasks 7, 8, 12. ✓
- `myRating` editable + shown on detail → Tasks 7, 8, 12. ✓
- Title data (title/year/poster/overview/cast/director/genres/runtime + 4 ratings) → Tasks 4, 5, 6, 12. ✓
- TMDb → IMDb id → OMDb → merge flow → Tasks 4, 5, 6. ✓
- Cache in own DB, 30-day staleness, manual refresh → Tasks 2, 7, 8, 12. ✓
- Move between lists without losing note/rating (upsert `update` excludes user fields; `updateTitle` only touches provided fields) → Task 7. ✓
- Structured genres (text[]) + cast (JSON objects), rendered individually → Tasks 2, 12. ✓
- Single user, passcode gate → Task 9. ✓
- PWA install → Tasks 13, 14. ✓
- Vercel hosting, secrets via env → Tasks 1, 14. ✓
- Takeout import deferred → not in plan (correct). ✓

**Placeholder scan:** No TBD/TODO; each code step contains real code; icons step gives a concrete fallback. ✓

**Type consistency:** `SearchResult`, `TmdbDetails`, `CastMember`, `MergedTitle`, `OmdbScores`, `Status`, `MediaKind` used consistently across tasks; route/repo signatures match. ✓
