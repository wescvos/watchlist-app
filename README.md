# Watchlist

A personal movie & TV watchlist — think of it as a replacement for Google's "Watchlist" / "Want to watch" feature, but with the piece Google never gave you: a proper **Watched** list alongside your **Want to watch** list, so you can track not just what you're planning to see but everything you already have.

Search any movie or series, add it to either list, and the app pulls in the cast, streaming availability, and ratings (IMDb/Rotten Tomatoes/Metacritic via OMDb, everything else via TMDb). Built as an installable PWA with Next.js 16, Prisma, and Postgres.

## Screenshots

<table>
  <tr>
    <td><img width="250" src="https://github.com/user-attachments/assets/70bdcce9-681c-4954-ae07-dd3da0aa5b70" /></td>
    <td><img width="250" src="https://github.com/user-attachments/assets/3cae1bc8-3ec3-4bf7-bda5-b052f415e7d3" /></td>
    <td><img width="250" src="https://github.com/user-attachments/assets/4687c0b7-d5dd-4e83-ab57-1aba009737da" /></td>
  </tr>
  <tr>
    <td><img width="250" src="https://github.com/user-attachments/assets/8979b22c-9f09-4b9a-b87a-e14b6d79d2a0" /></td>
    <td><img width="250" src="https://github.com/user-attachments/assets/0c47f20b-ea65-4f44-a672-96172b873f40" /></td>
    <td><img width="250" src="https://github.com/user-attachments/assets/3eb06479-8802-45c4-a019-874e89ae64dd" /></td>
  </tr>
</table>

## Prerequisites

- Node.js 20+ (matches the `@types/node` version this project builds against)
- A Postgres database — [Neon](https://neon.tech) (free tier) is what this project is built and deployed against
- A free [TMDb](https://www.themoviedb.org) API key
- A free [OMDb](https://www.omdbapi.com) API key

## Getting API keys

**TMDb:**
1. Create an account at https://www.themoviedb.org/signup and verify your email.
2. Go to Settings → API: https://www.themoviedb.org/settings/api
3. Click "click here" under "Request an API Key".
4. Choose the **Developer** type and accept the terms.
5. Fill in the application form — the "Application URL" field accepts any placeholder, e.g. `https://example.com`.
6. This gives you the value for `TMDB_API_KEY`.

**OMDb:**
1. Request a free key at https://www.omdbapi.com/apikey.aspx, choosing the **FREE** tier (1,000 requests/day).
2. Click the activation link emailed to you.
3. This gives you the value for `OMDB_API_KEY`.

## Environment variables

Copy `.env.example` to `.env.local` and fill in the four values:

```
DATABASE_URL=      # your Postgres connection string (see gotcha below)
TMDB_API_KEY=       # from the TMDb steps above
OMDB_API_KEY=       # from the OMDb steps above
APP_PASSCODE=       # any passcode you choose — gates access to your instance
```

`APP_PASSCODE` isn't tied to any external service — it's just a single shared passcode you make up, used to lock the app behind a simple gate.

## Local setup

```bash
npm install
npx prisma migrate deploy   # creates the schema in your database — starts completely empty
npm run dev
```

Open http://localhost:3000.

Your database starts **empty**. This is a fresh, clean instance — there's no seed data and no access to the original author's library, which lives in a separate database entirely. You add your own titles from scratch.

## Two gotchas

- **Use the direct Neon connection string, not the pooled one.** The host should *not* contain `-pooler`. `prisma migrate deploy` (run on every build, see below) needs a direct connection — the pooled connection string will fail or behave unreliably for migrations.
- **Don't mark `DATABASE_URL` as "Sensitive" in Vercel.** Doing so has caused intermittent build failures where the variable didn't resolve at build time. Add it as a normal environment variable instead.

## Deploy to Vercel

1. Import the repo into Vercel.
2. Set all four environment variables (`DATABASE_URL`, `TMDB_API_KEY`, `OMDB_API_KEY`, `APP_PASSCODE`) for the Production environment — per the gotchas above.
3. Deploy. The build script (`prisma generate && prisma migrate deploy && next build`) applies any pending migrations automatically on every deploy — no manual migration step needed.

## Install as an app (iOS / Android)

Once deployed, the app runs in the browser, but you can install it to your home screen so it behaves like a native app (full screen, its own icon, no browser chrome).

**iPhone / iPad (Safari):**
1. Open your deployed URL in **Safari** (this doesn't work from Chrome on iOS).
2. Tap the **Share** button (the square with an arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Confirm, and the icon appears on your home screen like any other app.

**Android (Chrome):**
1. Open your deployed URL in Chrome.
2. Tap the **⋮** menu (top right).
3. Tap **Add to Home screen** (or **Install app**).
4. Confirm to install.

## Migrating from Google

Already have a list in Google's "Want to watch"? You can bring it across.

1. Export your data via [Google Takeout](https://takeout.google.com) — include **Saved** (your want-to-watch lists) and **Search Contributions** (your watched history).
2. Drop the exported files into an `import/` folder at the project root (this folder is gitignored, so your personal data never gets committed).
3. Run the import in preview mode first to see what will match:
```bash
   npx tsx scripts/import-google-takeout.ts
```
   This is a **dry run** by default — it reports which titles matched confidently against TMDb and which need review, and writes nothing to your database.
4. When you're happy with the preview, run it again with `--commit` to actually import:
```bash
   npx tsx scripts/import-google-takeout.ts --commit
```

Titles from your watched history import as **Watched**; titles from your saved lists import as **Want to watch**. Anything that can't be matched confidently is skipped rather than guessed.

## Scripts

From `package.json`:

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | `prisma generate` + `prisma migrate deploy` + `next build` |
| `npm start` | Start the production server (after `build`) |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint the codebase |

`scripts/` also contains one-off utility scripts (a bulk title-metadata refresh, icon generation, and the Google Takeout import described above). These are standalone, run manually via `npx tsx scripts/<name>.ts`, and aren't part of normal setup.
