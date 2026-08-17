<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Operating rules

## Debugging

- When a bug survives two reasoned fixes, STOP theorizing and bisect: revert one variable at a time against "what changed since it last worked," deploy, test. Anchor to the timeline, not to code-reading.
- A hardcoded JSX attribute cannot be overridden by a later prop-based fix. Make it a prop.

## Verify, then ship

- Run `tsc`, `eslint`, `build`, and tests as SEPARATE gated steps that must all pass BEFORE pushing.
- Never chain verify-and-push in one command. A mid-chain `grep` exiting 0 once let a broken build reach prod.
- After deleting or renaming routes, run `next build` before trusting `tsc`: stale `.next/types/validator.ts` still imports removed routes and fails type-check spuriously.
- Changes are tested on the LIVE deployed site, so once verify is green, commit and push immediately. Never gate a push on a check that can only happen after the push.
- Before trusting a live test, confirm the Vercel deploy is Ready and hard-reload the PWA. Stale service-worker bundles cause false results.

## Git hygiene

- Never `git add -A`. Stage specific files by path.
- `tasks/` is scratch history and stays untracked.

## Database

- Generate migrations with `prisma migrate diff ... --script` (read-only). NEVER `migrate dev`, not even `--create-only`: it applies already-pending migrations to the connected DB as a side effect.
- Prisma 7: `--to-schema-datamodel` is removed (use `--from-schema`/`--to-schema`), and `--from-migrations` now requires a shadow database. If `--from-migrations` fails, diff schema-to-schema against `git show HEAD:prisma/schema.prisma` (read-only, no connection), and confirm `migrate status` is clean first so the committed schema is a valid baseline. Never fall back to `migrate dev`.
- Vercel's `DATABASE_URL` must be the DIRECT Neon string (no `-pooler`) and must NOT be marked Sensitive. Either one causes intermittent build failures.

## Gemini

- The model is `gemini-flash-latest`, a rolling alias. Never pin a version; pinned models get retired for new API keys and 404 while still appearing in ListModels.
- It is a thinking model whose reasoning tokens share `maxOutputTokens`. Keep `maxOutputTokens` generous (8192) and the input history bounded (~40 items), or responses truncate to empty.
- The free tier caps requests TWO ways: 20/day AND 5/minute. Any loop making multiple calls must pace itself (~15s apart), or it 429s on the 6th request inside the first minute with most of the daily budget still unspent. Both caps return the same 429, so a rate-limit message should name both.
- Rate limits are PER MODEL, not per project. Exhausting one model leaves every other model's budget untouched, so switching model is a valid recovery. Lite variants are far more generous (500/day, 15/minute) but weaker, so avoid them for judgement-heavy work.
- `gemini-flash-latest` moves as Google ships new Flash versions (3.7 Flash as of 2026-08-17). That protects against retired models but can walk you onto a brand-new, overloaded one: on 2026-08-17 the alias rolled onto 3.7 Flash on release day and every call 503'd. Prefer the alias by default, but pin deliberately (`--model`, `GEMINI_MODEL_OVERRIDE`) when it lands somewhere unstable. If output quality or token usage shifts with no code change, check what the alias resolves to before debugging.
- A 503 "high demand" DOES count against the daily quota, so retry 5xx with bounded backoff and never retry a 429 or 4xx. Also stop a batch loop after ~3 consecutive failures: a dead model will otherwise consume the whole day's budget one batch at a time.
