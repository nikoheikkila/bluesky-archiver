# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Cloudflare Worker (TypeScript, Wrangler) that runs daily at 03:00 UTC against one Bluesky account
(DID and server URL are Wrangler `vars` in `wrangler.jsonc`). The current slice is a **dry run**: it
lists the account's likes older than one year and logs a report; it deletes nothing. Later slices add
deletion of likes, reposts and posts, and a Bun CLI that reuses the core code.

## Commands

Bun is the package manager and script runner.

```bash
bun install
bun run test                                   # default suite (Vitest inside workerd via @cloudflare/vitest-pool-workers)
bunx vitest run test/select.test.ts            # one file
bunx vitest run -t "exactly one year"          # one test by name
bun run typecheck                              # tsc --noEmit
bun run test:live                              # opt-in: contract suite against the REAL account (read-only, ~35 requests)
bun run dev                                    # wrangler dev --test-scheduled; trigger with GET /cdn-cgi/handler/scheduled
bunx wrangler deploy --dry-run --outdir <dir>  # build the bundle without deploying
```

CI (`.github/workflows/deploy.yml`) runs typecheck and tests on every push to `main`, then
`wrangler deploy` using the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Architecture

The pipeline is `listLikes → selectOldLikes → formatReport → console.log`, wired in `src/index.ts`:

- `src/bluesky.ts` — `listLikes()` pages through the public `com.atproto.repo.listRecords` endpoint
  (`limit=100`) until an empty page or a missing cursor. It scans everything because record order
  follows record keys, not `createdAt`. A non-OK response throws, so the run fails with no total.
- `src/select.ts` — `selectOldLikes(likes, runStart)`: keeps likes with `createdAt` strictly more
  than 365 × 24 h before `runStart`, oldest first; counts unparseable/missing `createdAt` as skipped.
- `src/report.ts` — `formatReport()`: `<createdAt> <liked post URI>` lines, an optional skipped
  warning, then the total sentence (plural / singular / "No likes …"). Wording is fixed by the spec.
- `src/index.ts` — the only file allowed to use Worker-specific APIs. Run start is
  `controller.scheduledTime`. Everything else must use only web-standard APIs (`fetch`, `Date`,
  `console`) so the future Bun CLI can import it unchanged.

### Tests and the verified fake

- Every test runs against `test/fake-bluesky.ts`, an in-process fake that replaces global `fetch` via
  `vi.spyOn` (`fetchMock` isn't available in this pool version). It rejects any other origin, so the
  default suite never reaches the network. The test harness creates posts and likes on it, can delete
  posts (likes remain, as on the real server), and can inject HTTP failures per cursor (`failPage`).
- **The fake must behave like the real server.** Every non-empty page carries a cursor, even the
  last partial one; paging ends on an empty page without a cursor. `test/contract/list-records.contract.ts`
  is a shared contract suite run against the fake (`test/contract/fake.test.ts`, default suite) and
  against the real account (`live.contract.ts`, only via `bun run test:live`; it is not `*.test.ts`
  on purpose). Change the fake only together with the contract.
- Tests fix the run start explicitly so they pass at any wall-clock time.
- `test/acceptance.test.ts` drives the Worker's `scheduled` entry point for the scenario in
  `feature/dry-run-old-likes.feature`.
- `test/env.d.ts` augments the global `Cloudflare.Env` with the Worker's `Env` for typing in tests.

## Constraints

- No write or delete calls and no credentials in this slice; only `GET listRecords`.
- Cloudflare Workers Free plan only (no KV, D1, R2, Durable Objects): at most 50 outgoing requests
  per invocation and the Free-plan CPU limit. The fake and test code must never be bundled.
- `compatibility_date` is pinned to the newest date the installed `workerd` accepts; a later date
  fails to start the runtime.
- `.env` holds 1Password secret references (`op://…`), not secret values, so it is safe to track.
  Inject the real values into a command with `op run --env-file=.env <command>`, for example
  `op run --env-file=.env -- bunx wrangler deploy`. The Vitest runner also loads `.env` into the
  Worker's env in local tests, where the values stay unresolved references.

## Workflow

Work is spec-driven with the agentic-cd plugin (`/specify`, `/start-session`, `/review`,
`/end-session`). Specs live in `specs/<slug>.md`, which is **gitignored on purpose**: never commit
or force-add it. Feature files in `feature/` are tracked. Each spec has one Gherkin scenario
(the acceptance test) and a plan of TDD cycles; commits use Conventional Commits (`feat:`, `fix:`,
`docs(spec):`).
