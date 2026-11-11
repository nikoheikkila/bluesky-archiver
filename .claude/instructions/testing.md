# Testing

## Test Style

- No `vi.mock`, `vi.spyOn`, `vi.fn` or `vi.mocked`. The code under test takes its I/O as
  parameters: pass the fake's `fetch`, a hand-written stub such as
  `async () => Response.json(body)`, or `log: (entry) => { entries.push(entry); }` and assert on
  `entries` (`{ level, message, fields }`). A second run gets a second `createWorker` with fresh `entries`
  over the same fake. `newRun` in `test/scheduled.test.ts` also keeps `lines` (messages only) for
  regex filters and the password-leak checks.
- No `for`, `while`, `forEach` or `if`/`else` in tests. Use `test.each` for cases and a separate
  test for each branch. Assert over arrays with one matcher, for example
  `toStrictEqual(Array(n).fill(x))`. Seed with `addLikes(Array(n).fill(like))` or
  `addLikes(createdAts.map(...))`, not with a loop.
- The one exception is the paging loop in `test/contract/list-records.contract.ts`: how many pages
  exist is what the walk finds out. It only collects pages, and every assertion runs after it.

## Tests That Pin the Whole Run

- Most of `test/scheduled.test.ts` asserts the complete log (`toStrictEqual` over every entry,
  level included) and exact request sequences or counts. Adding a kind to the run appends an info
  `No <kind>s are older than one year` entry to every run that reaches the end, and adds that kind's
  listing requests to every request count. The integration tests assert `receivedWrites()` exactly,
  so a kind that deletes in their scenario adds a batch there.
- When a spec says which existing tests may change, build the list with grep, not from memory:
  `grep -n 'are older than one year"' test/*.test.ts` and `grep -n 'requests' test/scheduled.test.ts`.
  The reposts spec listed four tests and missed two, which stopped cycle 5 on its escalation
  trigger.

## Tests and Verified Fakes

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
- Shared test helpers, so no file redeclares them: `test/constants.ts` (`RUN_START`, `createdAgo`,
  `DID`, `BASE_URL`, `APP_PASSWORD`, `WRONG_PASSWORD`, `CID`, `rkeyOf`, `HOUR`/`DAY`/`YEAR`),
  `test/records.ts` (`recordOf`, a listed record of any collection for pure unit tests),
  `test/streams.ts` (`endlessBody`, a body that records its cancel) and `test/network.ts`
  (`createEnvBluesky()`, the fake on the Worker's own `env`). `createFakeBluesky()` defaults `did`
  and `baseUrl` to `DID` and `BASE_URL`; without `appPassword` every login is refused.
- The acceptance tests are integration tests, one per feature file:
  `test/delete-old-likes.integration.test.ts`, `test/delete-old-reposts.integration.test.ts`,
  `test/delete-old-posts.integration.test.ts` and `test/keep-pinned-post.integration.test.ts`.
  They run the real entry point, `src/index.ts`, inside workerd, with the Worker's own `env` and its
  global `fetch` and `console`. The helpers live in `test/network.ts`: `serveBluesky(bluesky)`
  routes every request to `BLUESKY_SERVER_URL` through MSW to the fake's `fetch`;
  `runDailyWorker(runStart)` calls the default export's `scheduled` with a controller from
  `cloudflare:test`; `deletesOf(collection, records)` builds the expected `applyWrites` batch.
  `exports.default` from `cloudflare:workers` has no typed `scheduled`, so the tests import the
  default export instead. The tests assert the fake's state and `receivedWrites()`, not the log: the
  real log goes to `console`, and the exact lines are pinned at the `createWorker` level in
  `test/scheduled.test.ts`. The fake's password is `env.BLUESKY_APP_PASSWORD`, which in tests is the
  unresolved `op://` reference from `.env`.
- `test/setup/network.ts` (a Vitest `setupFiles` entry) enables MSW (`@msw/cloudflare`) for the
  whole suite with `onUnhandledFrame: "error"`, so a request that no handler matches fails the test
  instead of reaching the network. It resets handlers after each test.
- `vitest.config.mts` runs every file in one workerd runtime (`maxWorkers: 1`, `isolate: false`) and
  pre-bundles `@bsky/sdk/lexicons` with the dep optimizer. That cut the suite from ~4 s to ~0.75 s,
  because isolated files each started a runtime and re-imported the lexicons. Sharing is safe only
  while no test patches a global, because a patched global would leak into every later file. The
  one sanctioned exception is MSW's patch of the global `fetch`: the setup file installs it once,
  for every file, on purpose. `experimental.fsModuleCache` does not work under workerd.
- `src/cloudflare.d.ts` is generated by `wrangler types` (run by `task typecheck`) from
  `wrangler.jsonc`; never edit it by hand, and Biome ignores it. `secrets.required` in
  `wrangler.jsonc` names `BLUESKY_APP_PASSWORD` as the only secret, so `wrangler types` no longer
  infers `Env` keys from `.env` (whose `CLOUDFLARE_*` deploy credentials are not Worker secrets),
  local runs load only that key from `.env`, and `wrangler deploy` fails if the secret is not set. It declares the global
  `Env` (also `Cloudflare.Env`, which types `env` from `cloudflare:workers`) and the Workers runtime
  types (`ScheduledController`, `ExportedHandler`, `RequestInit`, …). Use these instead of
  hand-written equivalents. The generated `Env` makes `BLUESKY_APP_PASSWORD` a required string, so
  the test of an unset secret passes `undefined` through a cast.
