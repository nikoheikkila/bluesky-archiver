# AGENTS.md

Guidance for coding agents working in this repository: what the Worker does, the commands, the
architecture, the constraints, and the pitfalls learned in earlier sessions.

## What This Is

A Cloudflare Worker (TypeScript, Wrangler) that runs daily at 03:00 UTC against one Bluesky account
(DID and server URL are Wrangler `vars` in `wrangler.jsonc`). Each run permanently deletes the
account's likes, reposts, posts (plain posts, replies and quote posts), reply settings
(`app.bsky.feed.threadgate`) and quote settings (`app.bsky.feed.postgate`) that are older than one
year (the age rule is under [Constraints](#constraints)). There is no mode or flag that turns
deletion off. Reposts are direct `app.bsky.feed.repost` records only. The pinned post is kept while
it stays pinned, however old it is; if the user unpins it or pins another post, the next daily run
deletes it. Its reply settings and quote settings are still deleted by the age rule.

## Commands

Bun is the package manager; [go-task](https://taskfile.dev) (`brew install go-task`) is the script
runner. Tasks live in `Taskfile.yml`; `package.json` keeps only the `prepare` lifecycle hook.

```bash
bun install
task test                                   # default suite (Vitest inside workerd via @cloudflare/vitest-pool-workers)
task test -- test/select.test.ts            # one file
task test -- -t "exactly one year"          # one test by name
task typecheck                              # tsc --noEmit
task lint                                   # Biome format + lint + import order (strict)
task lint:fix                               # applies Biome fixes
task check                                  # lint + typecheck + test + incremental mutation tests
task mutation                               # full Stryker run (slow; end-of-phase gate only)
task mutation:incremental                   # Stryker reusing reports/stryker-incremental.json
task mutation:diff [-- <base>]              # mutate only src/ files changed against the base branch (clean tree required)
bunx wrangler deploy --dry-run --outdir <dir>  # build the bundle without deploying
task logs                                   # stream the deployed Worker's logs, pretty-printed (needs the 1Password CLI)
task logs:json                              # same as JSON lines, for agents and jq
task logs:errors                            # only failed invocations
```

Biome (`biome.json`) formats and lints the code. A Lefthook pre-commit hook (`lefthook.yml`,
installed by `bun install` via `prepare`) runs `biome check --write` on staged files.

CI (`.github/workflows/deploy.yml`) runs on every push to `main`: the `test` job runs `task lint`,
`task typecheck`, `task test` and `task mutation:incremental` (with
`reports/stryker-incremental.json` cached), then the `deploy` job runs `wrangler deploy` using the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

### Version Control

This project uses Trunk-Based Development. Commits and pushes to `main` branch are allowed **if and only if** the
commit hooks pass. Never create a new feature branch unless the user explicitly tells you to.

### Logs

The `task logs*` tasks run `scripts/tail.sh`, which wraps `wrangler tail` in a loop that reconnects
when the session expires or drops; Ctrl-C (SIGINT/SIGTERM) stops it. The loop is a bash script
because task's built-in shell does not support `trap`. `wrangler tail` is live-only (a short gap
occurs during each reconnect), so leave one running before 03:00 UTC to catch the daily run. The
token (per-Worker Editor and Metadata Read-Only roles) can tail but cannot query historical logs
through the API; for history use Workers Logs in the dashboard, which keeps 3 days on the Free
plan.

In Workers Logs, filter on `$metadata.level` = `info` for the summary lines only, or `debug` for
the per-record lines. `wrangler tail` shows the same level per line (`.logs[].level` in
`task logs:json`).

### Mutation Testing

Stryker (`stryker.config.mjs`, Vitest runner) mutates `src/` except `src/index.ts`, which only binds
the global `fetch`, `console.debug` and `console.info` and cannot be tested without patching a
global. The score is 100% and `thresholds.break` is 100, so any surviving mutant fails the run,
`task check` and CI. Setup quirks: `tsconfigFile` points at a nonexistent file because
TypeScript 7 has no JS API for Stryker's tsconfig rewriter, and `ignorePatterns` keeps
`.claude`/`.agents` (symlinks) out of the sandbox copy. `.stryker-tmp/` and `reports/` are
gitignored.

Do not run the mutation harness inside each red-green cycle. Run it when work is ready, then kill
survivors with behaviour tests. Recheck with a scoped run, not the whole project:
`bunx stryker run --force --mutate src/<file>.ts[:<start>-<end>]`. Classify a survivor you cannot
kill as equivalent with a one-line argument rather than forcing a brittle test.

## Architecture

A run starts with one profile read (`readPinnedPost`, a `getRecord` of
`app.bsky.actor.profile/self`) that finds the pinned post. The pipeline per kind is
`listRecords → selectOldRecords → login (createSession) → deleteRecords (applyWrites) →
formatRecordLine / formatDeletionSummary → log`, built by `createWorker()` in `src/worker.ts` and
bound to the real `fetch` and `console` in `src/index.ts`. The kinds run in order in one
invocation: likes (`app.bsky.feed.like`), reposts (`app.bsky.feed.repost`), posts
(`app.bsky.feed.post`, with the pinned post removed before selection), reply settings
(`app.bsky.feed.threadgate`) and quote settings (`app.bsky.feed.postgate`). Login happens at most
once, and only when something is old. A kind with no old records skips deletion. After each batch
succeeds, one `debug` line (`deleting <noun> <record URI>`) is logged per deleted record; the
`info` summary lines for the kind follow. Any non-OK response throws, so the run fails without a
summary line for that kind, and a failed request in one kind stops the run before any request of
the kinds after it. A failed profile read fails the run before any other request, so nothing is
deleted.

- `src/bluesky.ts` — `listRecords({ baseUrl, did, collection, fetch })` pages through the public
  `com.atproto.repo.listRecords` endpoint for any collection (`limit=100`) until an empty page or a
  missing cursor. It scans every page, because record order follows record keys, not `createdAt`.
  `LIKE_COLLECTION` names the likes collection, and `listLikes()` is a thin wrapper over
  `listRecords` for it. Likes and reposts come back as subject records; posts, reply settings and
  quote settings have no `subject`, so they come back as any dated record (`RecordIn<C>`). It also
  exports the `Fetch` type every request goes through.
- `src/domain-types.ts` — type-only, emits nothing at runtime: the Bluesky lexicon record types
  (`SubjectRecordOf`, `LikeRecord`, `RepostRecord`, `SubjectRecord`, `DatedRecordOf`, `DatedRecord`,
  `Collection`, `RecordIn`). A subject record is a like or repost; a dated record is any record
  with a `createdAt`, which also covers posts, reply settings and quote settings. `RecordIn<C>`
  maps each collection to its own record type through a lookup, so an unnarrowed `Collection` gives
  the union of all five record types. `DatedRecord`'s `createdAt` is optional, because network
  records may lack it. Modules import them with `import type`.
- `src/select.ts` — `selectOldRecords(records, runStart)` holds the one age rule and returns the
  old records oldest first. A record with a missing or unparseable `createdAt` is counted as
  skipped. `selectOldLikes` is a thin wrapper over it.
- `src/session.ts` — `login({ baseUrl, did, password, fetch })` returns `fetchHandler(path, init)`,
  the atproto `Agent` shape. The deletion code depends only on `fetchHandler`, not on a raw token.
- `src/delete.ts` — `deleteRecords()` batches `com.atproto.repo.applyWrites` deletes for any
  collection, at most 200 per call. It is generic in its collection, so the records must be of that
  collection's type. Before the first `applyWrites`, it refuses a record whose URI is not
  `at://<did>/<collection>/<rkey>`, so no request is sent for it. `deleteLikes()` is a thin wrapper
  over it.
- `src/profile.ts` — `readPinnedPost({ baseUrl, did, fetch })` reads `app.bsky.actor.profile/self`
  with one unauthenticated `com.atproto.repo.getRecord` and returns the URI in
  `value.pinnedPost.uri`, or nothing; the CID is ignored. A missing profile (HTTP 400
  `RecordNotFound`) or one without `pinnedPost` pins nothing, and any other non-OK response throws.
  `withoutPinnedPost(records, pinnedUri)` drops the record whose `uri` equals the pinned URI. The
  posts kind uses it before selection, so the pinned post is neither found nor skipped, and is not
  logged.
- `src/report.ts` — `formatRecordLine()`, `formatLikeLine()` and `formatDeletionSummary()`, whose
  noun is "like", "repost", "post", "reply settings" or "quote settings". The settings nouns never
  change form. `formatRecordLine(record, noun)` prints the URI of the deleted record itself, not its
  subject or its post. Wording is fixed by the spec.
- `src/timeout.ts` — `withRequestTimeout(fetch, timeoutMs)` returns a fetch that aborts every
  request after `REQUEST_TIMEOUT_MS` (10 seconds). `createWorker` applies it to the injected fetch,
  so `getRecord`, `createSession`, `listRecords` and `applyWrites` all have it. A timed-out request
  rejects and fails the run like any other failed request. The module imports nothing from
  `@bsky/sdk` or `@atproto/lex`.
- `src/worker.ts` — `createWorker({ fetch, log, requestTimeoutMs })` returns the handlers object
  with `scheduled`. The optional `requestTimeoutMs` defaults to `REQUEST_TIMEOUT_MS` (10 seconds);
  tests inject a short value. It reads the `BLUESKY_APP_PASSWORD` secret and fails before listing
  when it is missing. Every request goes through the injected `fetch` and every report line through
  the injected `log` as a `LogEntry` (`{ level, message }`, where `LogLevel` is `"debug"` or
  `"info"`), which is how tests run it against the fake and pin each line's level.
- `src/index.ts` — the only file allowed to use Worker-specific APIs, and the only place bound to
  the real network and log: `export default createWorker({ fetch: (input, init) => fetch(input,
init), log: ({ level, message }) => writers[level](message) })`, where `writers` maps each
  `LogLevel` to the `console` method of the same name, which Workers Logs records as
  `$metadata.level`. The arrow keeps `fetch` called on the global (workerd rejects a detached
  `fetch` with "Illegal invocation"). Biome's `noConsole` allows only `log`, `debug` and `info`.
  Keep named runtime exports out of the main module. Every other file uses only web-standard APIs
  (`fetch`, `Date`, `console`) so the core can be reused.

### Tests and the Verified Fake

- Every test runs against `test/fake-bluesky.ts`, an in-process fake, and no test may reach the
  real server. Tests pass its `fetch` (`bluesky.fetch`) to the code under test. The `fetch`
  parameters in `src/` are required, so a test that forgets the fake fails typecheck, and the fake
  rejects any other origin. It serves `createSession`, `listRecords`, `applyWrites` and `getRecord`
  (the profile only), and offers failure injection (`failPage` per cursor, `failApplyWrites` per
  call, `failProfileRead` for the profile read). `receivedWrites()` returns the writes of every
  authorised `applyWrites` call in order, refused ones included. `addLikes()` and `addReposts()`
  seed many records in one call.
- `listRecords` serves `app.bsky.feed.like`, `app.bsky.feed.repost`, `app.bsky.feed.post`,
  `app.bsky.feed.threadgate` (reply settings) and `app.bsky.feed.postgate` (quote settings).
  `applyWrites` accepts deletes of those five collections only, at most 200 per call; it rejects
  any other collection, including `app.bsky.actor.profile`, with HTTP 400 and deletes nothing in
  that case.
- `getRecord` serves the account's profile record (`app.bsky.actor.profile`, record key `self`).
  Its response is `{ uri: "at://<did>/app.bsky.actor.profile/self", cid, value }`, and the fake
  validates the served `value` against the `app.bsky.actor.profile` lexicon.
- With no profile stored, `getRecord` answers HTTP 400 `{ "error": "RecordNotFound", "message":
  "Could not locate record: at://<did>/app.bsky.actor.profile/self" }`, as the real server does.
- Any other `getRecord`, meaning another collection or another record key, makes the fake throw, as
  it does for an unexpected origin.
- `pinPost(post, { cid? })` stores the profile with that post pinned. The post is an account post or
  another account's post from `addPost()`. The CID defaults to the post's, and `cid` overrides it.
- `addProfileWithoutPin()` stores a profile with no `pinnedPost`.
- `failProfileRead({ status })` makes every profile read answer with that HTTP status.
- The account's own posts (plain, reply, and quote posts with an `app.bsky.embed.record` or
  `app.bsky.embed.recordWithMedia` embed) are stored with `addAccountPost(post)` and read back with
  `accountPosts()`. `listRecords` serves them, and the fake validates each against its lexicon when
  stored, except that a missing or malformed `createdAt` is allowed.
- Reply settings and quote settings are stored with `addReplySettings({ post, createdAt })` and
  `addQuoteSettings({ post, createdAt })` and read back with `replySettings()` and
  `quoteSettings()`. A settings record shares its post's record key, so each settings record needs
  its own post. The fake validates each against its lexicon when stored, with the same `createdAt`
  exemption as posts. It checks the lexicon fields `hiddenReplies` (threadgate) and
  `detachedEmbeddingUris` (postgate) too.
- Subject posts from `addPost()` belong to another account and never appear in the account's post
  listing. The test harness can delete them with `deletePost()` (likes and reposts remain, as on
  the real server).
- The fake refuses a second reply-settings or quote-settings record for the same post, meaning the
  same record key in the same collection, by throwing, as a real server refuses a duplicate record
  key. One post can have one reply-settings record and one quote-settings record. Subject posts that
  likes and reposts point at belong to `did:plc:otheraccount222222222222`, a well-formed `did:plc`.
- Quote posts are account posts with an `app.bsky.embed.record` or `app.bsky.embed.recordWithMedia`
  embed, seeded with `addAccountPost()`. `listRecords` lists them like the other account posts.
- **The fake must behave like the real server.** Every collection pages the same way: every
  non-empty page carries a cursor, even the last partial one, and paging ends on an empty page
  without a cursor. `test/contract/` holds the shared contract suites (`list-records.contract.ts`,
  `write.contract.ts` and `get-record.contract.ts`), run against the fake by
  `test/contract/fake.test.ts` in the default suite. Change the fake only together with its
  contract.
- Tests fix the run start explicitly so they pass at any wall-clock time.
- `test/delete-old-likes.acceptance.test.ts`, `test/delete-old-reposts.acceptance.test.ts` and
  `test/delete-old-posts.acceptance.test.ts` drive the Worker's `scheduled` entry point, built by
  `createWorker` with the fake's `fetch` and a log collector, for the scenarios in
  `feature/delete-old-likes.feature`, `feature/delete-old-reposts.feature` and
  `feature/delete-old-posts.feature`.
- `vitest.config.mts` runs every file in one workerd runtime (`maxWorkers: 1`, `isolate: false`) and
  pre-bundles `@bsky/sdk/lexicons` with the dep optimizer. That cut the suite from ~4 s to ~0.75 s,
  because isolated files each started a runtime and re-imported the lexicons. Sharing is safe only
  while no test patches a global, because a patched global would leak into every later file.
  `experimental.fsModuleCache` does not work under workerd.
- `test/env.d.ts` augments the global `Cloudflare.Env` with the Worker's `Env` for typing in tests.

### Lexicon Validation and Deliberately Invalid Fixtures

- The fake validates every request and response against the official lexicons shipped in
  `@bsky/sdk`. Every record it serves (likes, reposts, posts, reply settings and quote settings) is
  validated against its record lexicon. `addAccountPost()` validates the post it stores against the
  `app.bsky.feed.post` lexicon with a fixed `createdAt`, so a stored account post's `createdAt` is
  not checked, as for served records, and undatable posts can be seeded.
- Records it serves may lack `createdAt` or carry a malformed one, because undatable records exist
  on the real server when they are written without validation. Every other field is still checked.
  Undatable records of every kind must stay servable, because the age rule never deletes them and
  tests prove it. Before tightening a check in the fake, grep for fixtures that are invalid on
  purpose: `grep -rn 'not-a-date\|createdAt: ""' test/`.
- The harness types `NewLike` and `NewRepost` (exported by the fake) require `createdAt`. Tests add
  a record without one through a cast (`{ subject } as unknown as NewRepost`), as in
  `test/contract/fake.test.ts`.
- A served record must omit a missing `createdAt`, not carry `createdAt: undefined`; the fake's own
  response validation rejects the latter.

### Test Style

- No `vi.mock`, `vi.spyOn`, `vi.fn` or `vi.mocked`. The code under test takes its I/O as
  parameters: pass the fake's `fetch`, a hand-written stub such as
  `async () => Response.json(body)`, or `log: (entry) => { entries.push(entry); }` and assert on
  `entries` (`{ level, message }`). A second run gets a second `createWorker` with fresh `entries`
  over the same fake. `newRun` in `test/scheduled.test.ts` also keeps `lines` (messages only) for
  regex filters and the password-leak checks.
- No `for`, `while`, `forEach` or `if`/`else` in tests. Use `test.each` for cases and a separate
  test for each branch. Assert over arrays with one matcher, for example
  `toStrictEqual(Array(n).fill(x))`. Seed with `addLikes(Array(n).fill(like))` or
  `addLikes(createdAts.map(...))`, not with a loop.
- The one exception is the paging loop in `test/contract/list-records.contract.ts`: how many pages
  exist is what the walk finds out. It only collects pages, and every assertion runs after it.

### Tests That Pin the Whole Run

- All three acceptance tests and most of `test/scheduled.test.ts` assert the complete log
  (`toStrictEqual` over every entry, level included) and exact request sequences or counts. Adding
  a kind to the run appends an info `No <kind>s are older than one year` entry to every run that
  reaches the end, and adds that kind's listing requests to every request count.
- When a spec says which existing tests may change, build the list with grep, not from memory:
  `grep -n 'are older than one year"' test/*.test.ts` and `grep -n 'requests' test/scheduled.test.ts`.
  The reposts spec listed four tests and missed two, which stopped cycle 5 on its escalation
  trigger.

## Constraints

- The Worker sends only `GET getRecord` (for `app.bsky.actor.profile`, record key `self`),
  `GET listRecords` (for `app.bsky.feed.like`, `app.bsky.feed.repost`, `app.bsky.feed.post`,
  `app.bsky.feed.threadgate` and `app.bsky.feed.postgate`), `POST createSession` and
  `POST applyWrites`. `applyWrites` carries deletes of those five feed collections only, one
  collection per batch and never mixed. It never deletes `app.bsky.actor.profile`, follows, blocks
  or lists, and it never calls `deleteSession`.
- The age rule is a global invariant and applies to every record kind the Worker deletes. A record
  is older than one year when its own `createdAt` is strictly more than 365 × 24 h before the run
  starts; the run start is `controller.scheduledTime`, and the comparison is in UTC. A record whose
  subject was deleted, or whose author has left, is judged by its own `createdAt` too. A record
  with a missing or unparseable `createdAt` is never deleted. The one exception is the pinned post,
  the account post whose `uri` equals `value.pinnedPost.uri` in the profile; it is kept while it
  stays pinned, however old it is. Its reply settings and quote settings follow the age rule like
  all others. A post the user unpins, or replaces by pinning another, is deleted by the next run if
  it is old. Once the backlog is cleared, no record is older than 366 days, except the pinned post.
- The profile read comes before every other request. A failed read (an HTTP 400 other than
  `RecordNotFound`, any other non-OK response, or a timeout) fails the run before any other
  request, so nothing is deleted. A missing profile, or a profile without `pinnedPost`, pins
  nothing.
- It holds one secret, `BLUESKY_APP_PASSWORD`, a Worker secret whose `.env` entry is an `op://`
  reference, never the value. The password must never appear in logs, errors, or the repository.
- Any Cloudflare resource (KV, D1, R2, Durable Objects, and so on) is allowed when its usage stays
  within its free tier.
- `compatibility_date` is pinned to the newest date the installed `workerd` accepts; a later date
  fails to start the runtime.
- The fake and test code must never be bundled, and `@bsky/sdk` and `@atproto/lex` must never be
  imported from `src/` or bundled.
- `.env` holds 1Password secret references (`op://…`), not secret values, so it is safe to track.
  Inject the real values into a command with `op run --env-file=.env <command>`, for example
  `op run --env-file=.env -- bunx wrangler deploy`. Set the secret with `op run`, piping the value
  on stdin, because the interactive prompt fails under `op run`. The Vitest runner also loads `.env`
  into the Worker's env in local tests, where the values stay unresolved references.

### Request Budget

- The Workers Free plan allows at most 50 outgoing requests per invocation and has a CPU limit; the
  specs escalate above 45. A run's requests are the sum over the five kinds of `ceil(n / 100) + 1`
  listings (`n` is the kind's record count, and an empty kind costs 1), plus 1 `getRecord` for the
  profile, plus 1 `createSession` when any record is old, plus the sum over kinds of
  `ceil(old / 200)` `applyWrites` (`old` is the kind's old-record count; a kind with no old records
  adds none). The `+ 1` in a listing is the empty page that ends the walk, since every non-empty
  page carries a cursor.
- Today's listings alone are 37: likes 22 (2,056 records), reposts 4 (235), posts 8 (662),
  threadgate 2 (1) and postgates 1 (0). A day that deletes from three kinds, each within one
  200-record batch, makes 42 requests: 37 listings, 1 `getRecord`, 1 `createSession` and 3
  `applyWrites`.
- The thresholds depend on the posts, the only kind that can outgrow one batch. The other kinds
  stay at today's 29 listings (likes 22, reposts 4, threadgate 2, postgates 1) with no old records.
  With `p` posts of which `o` are old:
  - quiet day (`o = 0`): `31 + ceil(p / 100)` requests. Above 45 from 1,401 posts; above 50 from
    1,901.
  - one posts batch (`1 <= o <= 200`): `33 + ceil(p / 100)`. Above 45 from 1,201 posts; above 50
    from 1,701.
  - backlog (`o = p`, so `ceil(p / 200)` batches): `32 + ceil(p / 100) + ceil(p / 200)`. Above 45
    from 801 posts; above 50 from 1,201. At 1,201 posts that is 43 listings, 1 `getRecord`, 1
    `createSession` and 7 `applyWrites`: 52.

  Every post being old is the worst case for a given `p`, so the backlog line is the highest bound.
- After the post backlog is cleared, only posts under a year old remain. With today's 2,056 likes,
  235 reposts, 1 threadgate and no postgate (29 listings), 34 listings need 301 to 400 posts left,
  because those posts cost 5 listings. With all five kinds old and each within one batch, a run
  makes about 41 requests: 34 listings, 1 `getRecord`, 1 `createSession` and 5 `applyWrites`. A
  kind with more than 200 old records adds `ceil(old / 200) - 1` `applyWrites` for that kind.
- The listings of all five kinds share the 50-request cap, so the account's size is a limit too.
  The run order is likes, reposts, posts, threadgate, postgates, so 26 listings (likes 22, reposts
  4) come before posts. Past 50, the run fails at the request that crosses the cap, and the kinds
  after it do not run. This is documented, not capped; it is to be revisited in a later slice.

## Workflow

Work is spec-driven with the agentic-cd plugin (`/specify`, `/start-session`, `/review`,
`/end-session`). Specs live in `specs/<slug>.md`, which is **gitignored on purpose**: never commit
or force-add it. Feature files in `feature/` are tracked. Each spec has one Gherkin scenario
(the acceptance test) and a plan of TDD cycles; commits use Conventional Commits (`feat:`, `fix:`,
`docs(spec):`). Adding a record kind follows
`.claude/skills/add-record-kind/SKILL.md`.
