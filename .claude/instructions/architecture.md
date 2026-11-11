# Architecture

A run starts with one profile read (`readPinnedPost`, a `getRecord` of
`app.bsky.actor.profile/self`) that finds the pinned post. The pipeline per kind is
`listRecords → selectOldRecords → login (createSession) → deleteRecords (applyWrites) →
recordEntry / summaryEntries → log`, built by `createWorker()` in `src/worker.ts` as one loop over its `KINDS` table and
bound to the real `fetch` and `console` in `src/index.ts`.

The kinds run in order in one
invocation: likes (`app.bsky.feed.like`), reposts (`app.bsky.feed.repost`), posts
(`app.bsky.feed.post`, with the pinned post removed before selection), reply settings
(`app.bsky.feed.threadgate`) and quote settings (`app.bsky.feed.postgate`).

Login happens at most
once, and only when something is old. A kind with no old records skips deletion.

After each batch
succeeds, one `debug` line (`deleting <noun> <record URI>`) is logged per deleted record; the
`info` summary lines for the kind follow. Any non-OK response throws, so the run fails without a
summary line for that kind, and a failed request in one kind stops the run before any request of
the kinds after it. A failed profile read fails the run before any other request, so nothing is
deleted.

## Module Responsibilities

- `src/bluesky.ts` — `listRecords({ baseUrl, did, collection, fetch })` pages through the public
  `com.atproto.repo.listRecords` endpoint for any collection (`limit=100`) until an empty page or a
  missing cursor. It scans every page, because record order follows record keys, not `createdAt`.
  Likes and reposts come back as subject records; posts, reply settings and
  quote settings have no `subject`, so they come back as any dated record (`RecordIn<C>`). It also
  exports the `Fetch` type every request goes through, and `Repo` (`{ baseUrl, did, fetch }`), the
  options shared by `listRecords`, `readPinnedPost` and `login`.
- `src/domain-types.ts` — type-only, emits nothing at runtime: the Bluesky lexicon record types
  (`SubjectRecordOf`, `LikeRecord`, `RepostRecord`, `SubjectRecord`, `DatedRecordOf`, `DatedRecord`,
  `Collection`, `RecordIn`). `Collection` is the key set of the record lookup, so a new kind is
  added in one place. A subject record is a like or repost; a dated record is any record
  with a `createdAt`, which also covers posts, reply settings and quote settings. `RecordIn<C>`
  maps each collection to its own record type through a lookup, so an unnarrowed `Collection` gives
  the union of all five record types. `DatedRecord`'s `createdAt` is optional, because network
  records may lack it. Modules import them with `import type`.
- `src/select.ts` — `selectOldRecords(records, runStart)` holds the one age rule and returns the
  old records oldest first. A record with a missing or unparseable `createdAt` is counted as
  skipped.
- `src/session.ts` — `login({ baseUrl, did, password, fetch })` returns `fetchHandler(path, init)`,
  the atproto `Agent` shape. The deletion code depends only on `fetchHandler`, not on a raw token.
- `src/delete.ts` — `deleteRecords()` batches `com.atproto.repo.applyWrites` deletes for any
  collection, at most 200 per call. It is generic in its collection, so the records must be of that
  collection's type. Before the first `applyWrites`, it refuses a record whose URI is not
  `at://<did>/<collection>/<rkey>`, so no request is sent for it.
- `src/profile.ts` — `readPinnedPost({ baseUrl, did, fetch })` reads `app.bsky.actor.profile/self`
  with one unauthenticated `com.atproto.repo.getRecord` and returns the URI in
  `value.pinnedPost.uri`, or nothing; the CID is ignored. A missing profile (HTTP 400
  `RecordNotFound`) or one without `pinnedPost` pins nothing, and any other non-OK response throws.
  `withoutPinnedPost(records, pinnedUri)` drops the record whose `uri` equals the pinned URI. The
  worker applies it to every kind before selection (the pinned URI names a post, so it only ever
  matches in the posts kind), so the pinned post is neither found nor skipped, and is not logged.
- `src/report.ts` — `recordEntry(record, noun)` and `summaryEntries(summary, noun)` return report
  lines as `ReportEntry` (`{ message, fields }`), whose noun is "like", "repost", "post", "reply
  settings" or "quote settings". The settings nouns never change form. A record line prints the URI
  of the deleted record itself, not its subject or its post. Wording is fixed by the spec.
- `src/body.ts` — `readJson(response, maxBytes)` reads a JSON body of at most `MAX_RESPONSE_BYTES`
  (8 MiB; a 100-record page is about 100 KB). A body declared larger by `Content-Length`, or streamed
  past the cap, is cancelled and rejected with `response body exceeds <n> bytes`; invalid JSON
  rejects with `SyntaxError`, as `response.json()` does. `failRequest(response, name)` discards a
  non-OK body and throws `<name> failed with HTTP <status>`. `listRecords`, `login` and
  `readPinnedPost` read every body through it, never with `response.json()`. `discardBody(response)`
  cancels a body that will not be read, ignoring a body already read and a failed cancel, so a
  non-OK `listRecords`, `createSession` or `getRecord` releases its connection before the run fails.
- `src/timeout.ts` — `withRequestTimeout(fetch, timeoutMs)` returns a fetch that aborts every
  request after `REQUEST_TIMEOUT_MS` (10 seconds). `createWorker` applies it to the injected fetch,
  so `getRecord`, `createSession`, `listRecords` and `applyWrites` all have it. A timed-out request
  rejects and fails the run like any other failed request. The module imports nothing from
  `@bsky/sdk` or `@atproto/lex`.
- `src/worker.ts` — `createWorker({ fetch, log, requestTimeoutMs })` returns the handlers object
  with `scheduled(controller: ScheduledController, env: Env)`, typed by the generated types. The optional `requestTimeoutMs` defaults to `REQUEST_TIMEOUT_MS` (10 seconds);
  tests inject a short value. It reads the `BLUESKY_APP_PASSWORD` secret and fails before listing
  when it is missing. Every request goes through the injected `fetch` and every report line through
  the injected `log` as a `LogEntry` (`{ level, message, fields }`, where `LogLevel` is `"debug"` or
  `"info"`), which is how tests run it against the fake and pin each line's level and fields.
- `src/index.ts` — the only file allowed to use Worker-specific APIs, and the only place bound to
  the real network and log: `export default createWorker({ fetch: (input, init) => fetch(input,
init), log: ({ level, message, fields }) => writers[level](JSON.stringify({ message, ...fields }))
})`, where `writers` maps each
  `LogLevel` to the `console` method of the same name, which Workers Logs records as
  `$metadata.level`. The arrow keeps `fetch` called on the global (workerd rejects a detached
  `fetch` with "Illegal invocation"). Biome's `noConsole` allows only `log`, `debug` and `info`.
  Keep named runtime exports out of the main module. Every other file uses only web-standard APIs
  (`fetch`, `Date`, `console`) so the core can be reused.

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
  fails to start the runtime. Check it with
  `node -e "import('workerd').then(m => console.log(m.compatibilityDate))"`, and review the
  compatibility flags that turn on between the old and new dates before bumping it.
  `compatibility_flags` holds `nodejs_compat` (the Vitest plugin injects it in tests anyway), and
  `upload_source_maps` is on. `workers_dev` and `preview_urls` are off: the Worker has no fetch
  handler, so it has no public URL, and the cron trigger is its only entry point.
- Every response body read in full goes through `readJson`'s 8 MiB cap, so a misbehaving server
  cannot exhaust the 128 MB memory limit.
- The fake and test code must never be bundled, and `@bsky/sdk` and `@atproto/lex` must never be
  imported from `src/` or bundled.
- `.env` holds 1Password secret references (`op://…`), not secret values, so it is safe to track.
  This is a deliberate exception to the Workers best practice of gitignoring `.env`.
  Inject the real values into a command with `op run --env-file=.env <command>`, for example
  `op run --env-file=.env -- bunx wrangler deploy`. Set the secret with `op run`, piping the value
  on stdin, because the interactive prompt fails under `op run`. The Vitest runner also loads `.env`
  into the Worker's env in local tests, where the values stay unresolved references.

## Request Budget

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
  The run order is likes, reposts, posts, threadgate, postgates, so 26 listings (likes 22, reposts 4) come before posts. Past 50, the run fails at the request that crosses the cap, and the kinds
  after it do not run. This is documented, not capped; it is to be revisited in a later slice.
