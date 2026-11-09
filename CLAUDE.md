# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Cloudflare Worker (TypeScript, Wrangler) that runs daily at 03:00 UTC against one Bluesky account
(DID and server URL are Wrangler `vars` in `wrangler.jsonc`). Each run permanently deletes the
account's likes and reposts whose `createdAt` is more than 365 × 24 h before the run start.
Deletion is permanent, and there is no mode or flag that turns it off. Likes are processed first,
then reposts, in the same invocation, with one login at most, and only when something is old.
Reposts are direct `app.bsky.feed.repost` records only. Posts (including quote posts) are not
touched yet. Later slices may add posts, and OAuth in place of the app password.

## Commands

Bun is the package manager; [go-task](https://taskfile.dev) (`brew install go-task`) is the script runner.
Tasks live in `Taskfile.yml`; `package.json` keeps only the `prepare` lifecycle hook.

```bash
bun install
task test                                      # default suite (Vitest inside workerd via @cloudflare/vitest-pool-workers); every test runs against the in-process fake
task test -- test/select.test.ts        # one file: task test -- test/<file>.test.ts
task test -- -t "exactly one year"      # one test by name: task test -- -t "<name>"
task typecheck                              # tsc --noEmit
task lint                                   # Biome format + lint + import order (strict)
task lint:fix                               # applies Biome fixes
task dev                                    # wrangler dev --test-scheduled; trigger with GET /cdn-cgi/handler/scheduled
bunx wrangler deploy --dry-run --outdir <dir>  # build the bundle without deploying
```

Logs (requires 1Password CLI too):

```bash
task logs          # stream the deployed Worker's logs, pretty-printed
task logs:json     # same as JSON lines, for agents and jq
task logs:errors   # only failed invocations
```

The tasks run `scripts/tail.sh`, which wraps `wrangler tail` in a loop that reconnects when the
session expires or drops; Ctrl-C (SIGINT/SIGTERM) stops it. The loop is a bash script because
task's built-in shell does not support `trap`. `wrangler tail` is live-only (a short gap occurs
during each reconnect), so leave one running before 03:00 UTC to catch the daily run. The token
(per-Worker Editor and Metadata Read-Only roles) can tail but cannot query historical logs through
the API; for history use Workers Logs in the dashboard (3 days).

**Warning:** the scheduled handler deletes likes and reposts. Do not trigger it under `task dev` against the
real account.

Biome (`biome.json`) formats and lints the code. A Lefthook pre-commit hook (`lefthook.yml`, installed by `bun install` via `prepare`) runs `biome check --write` on staged files.

CI (`.github/workflows/deploy.yml`) runs `task lint`, `task typecheck` and `task test` on every push to `main`, then
`wrangler deploy` using the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Architecture

The pipeline per kind is `listRecords → selectOldRecords → login (createSession) → deleteRecords
(applyWrites) → formatRecordLine / formatDeletionSummary → console.log`, wired in `src/index.ts`.
The kinds run in order: likes (`app.bsky.feed.like`) first, then reposts (`app.bsky.feed.repost`).
Login happens once, and only when something is old. Deletion runs in batches of at most 200, oldest
first, and one line is logged per deleted record after each batch succeeds, followed by a summary
line whose noun is "like" or "repost". Deletion is skipped for a kind when none of its records is
old enough. Any non-OK response throws, so the run fails without a summary line for that kind, and a
failed likes request stops the run before any repost request.

- `src/bluesky.ts` — `listRecords({ baseUrl, did, collection })` pages through the public
  `com.atproto.repo.listRecords` endpoint for any collection (`limit=100`) until an empty page or a
  missing cursor. It scans every page, because record order follows record keys, not `createdAt`.
  `LIKE_COLLECTION` names the likes collection, and `listLikes()` is a thin wrapper over
  `listRecords` for it.
- `src/select.ts` — `selectOldRecords(records, runStart)` holds the one age rule. It keeps records
  whose `createdAt` is strictly more than 365 × 24 h before `runStart`, oldest first. A missing or
  unparseable `createdAt` is counted as skipped and never selected. `selectOldLikes` is a thin
  wrapper over it.
- `src/session.ts` — `login()` returns `fetchHandler(path, init)`, the atproto `Agent` shape. The
  deletion code depends only on `fetchHandler`, not on a raw token.
- `src/delete.ts` — `deleteRecords()` batches `com.atproto.repo.applyWrites` deletes, at most 200
  per call, for any collection, never mixing collections in one call. `deleteLikes()` is a thin
  wrapper over it.
- `src/report.ts` — `formatRecordLine()`, `formatLikeLine()` and `formatDeletionSummary()`, whose
  noun is "like" or "repost". Wording is fixed by the spec.
- `src/index.ts` — the only file allowed to use Worker-specific APIs; it holds the `scheduled`
  handler. Run start is `controller.scheduledTime`. It reads the `BLUESKY_APP_PASSWORD` secret and
  fails before listing when it is missing. Everything else must use only web-standard APIs
  (`fetch`, `Date`, `console`) so the core can be reused.

### Tests and the verified fake

- Every test runs against `test/fake-bluesky.ts`, an in-process fake that replaces global `fetch` via
  `vi.spyOn` (`fetchMock` isn't available in this pool version). It rejects any other origin, so the
  default suite never reaches the network. It serves `createSession`, `listRecords` and
  `applyWrites`, and offers failure injection (`failPage` per cursor, `failApplyWrites` per call).
  `listRecords` serves `app.bsky.feed.like` and `app.bsky.feed.repost`. `applyWrites` accepts
  deletes of those two collections only, at most 200 per call; it rejects anything else, including
  deletes of `app.bsky.feed.post`, with HTTP 400 and deletes nothing in that case. The fake also
  models the account's quote posts (`app.bsky.feed.post` records with an `app.bsky.embed.record`
  embed): tests store them and read them back, but `listRecords` never lists them. The test harness
  can also delete posts (likes and reposts remain, as on the real server).
- The fake validates every request and response against the official lexicons shipped in
  `@bsky/sdk`. Every like and repost record it serves, and every quote post it stores, is validated
  against its record lexicon from `@bsky/sdk`. For like and repost records it serves, a missing or
  malformed `createdAt` is allowed, because undatable records exist on the real server when they are
  written without validation. Every other field is still checked. Quote posts are validated in full,
  `createdAt` included, when stored.
- **The fake must behave like the real server.** Likes and reposts page the same way: every
  non-empty page carries a cursor, even the last partial one, and paging ends on an empty page
  without a cursor. `test/contract/` holds the shared contract suites (`list-records.contract.ts`
  and `write.contract.ts`), run against the fake by `test/contract/fake.test.ts` in the default
  suite. No contract runs against the real server any more, and no test may reach it. Change the
  fake only together with its contract.
- Tests fix the run start explicitly so they pass at any wall-clock time.
- `test/delete-old-likes.acceptance.test.ts` drives the Worker's `scheduled` entry point for the
  scenario in `feature/delete-old-likes.feature`.
- `test/env.d.ts` augments the global `Cloudflare.Env` with the Worker's `Env` for typing in tests.

## Constraints

- The Worker sends only `GET listRecords` (for `app.bsky.feed.like` and `app.bsky.feed.repost`),
  `POST createSession` and `POST applyWrites`. `applyWrites` carries deletes of `app.bsky.feed.like`
  and `app.bsky.feed.repost` records only, never one collection mixed with another and never
  `app.bsky.feed.post`. It never calls `deleteSession`.
- The age rule is a global invariant and applies to every record kind the Worker deletes. A record
  is older than one year when its own `createdAt` is more than 365 × 24 h before the run starts; the
  run start is `controller.scheduledTime`, and the comparison is in UTC. A record whose subject was
  deleted, or whose author has left, is judged by its own `createdAt` too. A record with a missing
  or unparseable `createdAt` is never deleted. Once the backlog is cleared, no record is older than
  366 days.
- It holds one secret, `BLUESKY_APP_PASSWORD`, a Worker secret whose `.env` entry is an `op://`
  reference, never the value. The password must never appear in logs, errors, or the repository.
- Any Cloudflare resource (KV, D1, R2, Durable Objects, and so on) is allowed when its usage stays
  within its free tier. The Workers Free plan allows at most 50 outgoing requests per invocation and
  has a CPU limit; a run uses about 31 requests at the current backlog. Workers Logs keeps 3 days
  on the Free plan; the run's log lines are how the daily found count is checked.
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
