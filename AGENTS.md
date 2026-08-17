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
