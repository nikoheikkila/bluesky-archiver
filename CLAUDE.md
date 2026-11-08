# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Cloudflare Worker (TypeScript, Wrangler) that runs daily at 03:00 UTC against one Bluesky account
(DID and server URL are Wrangler `vars` in `wrangler.jsonc`). Each run permanently deletes the
account's likes whose `createdAt` is more than 365 × 24 h before the run start. Deletion is
permanent, and there is no mode or flag that turns it off. Later slices may add reposts and posts,
and OAuth in place of the app password.

## Commands

Bun is the package manager and script runner.

```bash
bun install
bun run test                                   # default suite (Vitest inside workerd via @cloudflare/vitest-pool-workers); every test runs against the in-process fake
bunx vitest run test/select.test.ts            # one file: bunx vitest run test/<file>.test.ts
bunx vitest run -t "exactly one year"          # one test by name: bunx vitest run -t "<name>"
bun run typecheck                              # tsc --noEmit
bun run dev                                    # wrangler dev --test-scheduled; trigger with GET /cdn-cgi/handler/scheduled
bunx wrangler deploy --dry-run --outdir <dir>  # build the bundle without deploying
```

**Warning:** the scheduled handler deletes likes. Do not trigger it under `bun run dev` against the
real account.

CI (`.github/workflows/deploy.yml`) runs typecheck and tests on every push to `main`, then
`wrangler deploy` using the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Architecture

The pipeline is `listLikes → selectOldLikes → login (createSession) → deleteLikes (applyWrites) →
formatLikeLine / formatDeletionSummary → console.log`, wired in `src/index.ts`. Deletion runs in
batches of at most 200, oldest first, and one line is logged per deleted like after each batch
succeeds. Login and deletion are skipped when no like is old enough; any non-OK response throws, so
the run fails without a summary line.

- `src/bluesky.ts` — `listLikes()` pages through the public `com.atproto.repo.listRecords` endpoint
  (`limit=100`) until an empty page or a missing cursor. It scans every page because record order
  follows record keys, not `createdAt`.
- `src/select.ts` — `selectOldLikes(likes, runStart)`: keeps likes with `createdAt` strictly more
  than 365 × 24 h before `runStart`, oldest first; a missing or unparseable `createdAt` is counted
  as skipped and never deleted.
- `src/session.ts` — `login()` returns `fetchHandler(path, init)`, the atproto `Agent` shape. The
  deletion code depends only on `fetchHandler`, not on a raw token.
- `src/delete.ts` — `deleteLikes()`: `com.atproto.repo.applyWrites` deletes in batches of at most 200.
- `src/report.ts` — `formatLikeLine()` and `formatDeletionSummary()`. Wording is fixed by the spec.
- `src/index.ts` — the only file allowed to use Worker-specific APIs. Run start is
  `controller.scheduledTime`. It reads the `BLUESKY_APP_PASSWORD` secret and fails before listing
  when it is missing. Everything else must use only web-standard APIs (`fetch`, `Date`, `console`)
  so the core can be reused.

### Tests and the verified fake

- Every test runs against `test/fake-bluesky.ts`, an in-process fake that replaces global `fetch` via
  `vi.spyOn` (`fetchMock` isn't available in this pool version). It rejects any other origin, so the
  default suite never reaches the network. It serves `listRecords`, `createSession` and
  `applyWrites` (deletes of `app.bsky.feed.like` only, at most 200 per call), validates every
  request and response against the official lexicons shipped in `@bsky/sdk`, and offers failure
  injection (`failPage` per cursor, `failApplyWrites` per call). The test harness can also delete
  posts (likes remain, as on the real server).
- **The fake must behave like the real server.** Every non-empty page carries a cursor, even the
  last partial one; paging ends on an empty page without a cursor. `test/contract/` holds the shared
  contract suites (`list-records.contract.ts` and `write.contract.ts`), run against the fake by
  `test/contract/fake.test.ts` in the default suite. No contract runs against the real server any
  more, and no test may reach it. Change the fake only together with its contract.
- Tests fix the run start explicitly so they pass at any wall-clock time.
- `test/delete-old-likes.acceptance.test.ts` drives the Worker's `scheduled` entry point for the
  scenario in `feature/delete-old-likes.feature`.
- `test/env.d.ts` augments the global `Cloudflare.Env` with the Worker's `Env` for typing in tests.

## Constraints

- The Worker sends only `GET listRecords`, `POST createSession` and `POST applyWrites` (deletes of
  `app.bsky.feed.like` records only); it never calls `deleteSession`.
- It holds one secret, `BLUESKY_APP_PASSWORD`, a Worker secret whose `.env` entry is an `op://`
  reference, never the value. The password must never appear in logs, errors, or the repository.
- Any Cloudflare resource (KV, D1, R2, Durable Objects, and so on) is allowed when its usage stays
  within its free tier. The Workers Free plan allows at most 50 outgoing requests per invocation and
  has a CPU limit. Workers Logs keeps 3 days on the Free plan; the run's log lines are how the
  daily found count is checked.
- `compatibility_date` is pinned to the newest date the installed `workerd` accepts; a later date
  fails to start the runtime.
- The fake and test code must never be bundled, and `@bsky/sdk` and `@atproto/lex` must never be
  imported from `src/` or bundled.
- `.env` holds 1Password secret references (`op://…`), not secret values, so it is safe to track.
  Inject the real values into a command with `op run --env-file=.env <command>`, for example
  `op run --env-file=.env -- bunx wrangler deploy`. Set the secret with `op run`, piping the value
  on stdin, because the interactive prompt fails under `op run`. The Vitest runner also loads `.env`
  into the Worker's env in local tests, where the values stay unresolved references.

## Workflow

Work is spec-driven with the agentic-cd plugin (`/specify`, `/start-session`, `/review`,
`/end-session`). Specs live in `specs/<slug>.md`, which is **gitignored on purpose**: never commit
or force-add it. Feature files in `feature/` are tracked. Each spec has one Gherkin scenario
(the acceptance test) and a plan of TDD cycles; commits use Conventional Commits (`feat:`, `fix:`,
`docs(spec):`).
