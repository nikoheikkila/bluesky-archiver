# AGENTS.md

Pitfalls and working rules learned in earlier sessions. `CLAUDE.md` holds the architecture,
commands and constraints; this file holds what was not obvious from them. Adding a new record kind
(posts are next) has its own checklist in `.claude/skills/add-record-kind/SKILL.md`.

## Test style

- No `vi.mock`, `vi.spyOn`, `vi.fn` or `vi.mocked`. The code under test takes its I/O as
  parameters: pass `bluesky.fetch` from the fake, a hand-written stub such as
  `async () => Response.json(body)`, or `log: (line) => { lines.push(line); }` and assert on
  `lines`. A second run gets a second `createWorker` with fresh `lines` over the same fake.
- No `for`, `while`, `forEach` or `if`/`else` in tests. Use `test.each` for cases and a separate
  test for each branch. Assert over arrays with one matcher, for example
  `toStrictEqual(Array(n).fill(x))`. Seed with `addLikes(Array(n).fill(like))` or
  `addLikes(createdAts.map(...))`, not with a loop.
- The one exception is the paging loop in `test/contract/list-records.contract.ts`: how many pages
  exist is what the walk finds out. It only collects pages, and every assertion runs after it.
- The suite shares one workerd runtime (`isolate: false`). A test that patched a global would leak
  into every later file, which is one more reason for injection over spies.

## Tests that pin the whole run

- Both acceptance tests and most of `test/scheduled.test.ts` assert the complete log
  (`toStrictEqual` over every line) and exact request sequences or counts. Adding a kind to the run
  appends a `No <kind>s are older than one year` line to every run that reaches the end, and adds
  that kind's listing requests to every request count.
- When a spec says which existing tests may change, build the list with grep, not from memory:
  `grep -n 'are older than one year"' test/*.test.ts` and `grep -n 'requests' test/scheduled.test.ts`.
  The reposts spec listed four tests and missed two, which stopped cycle 5 on its escalation
  trigger.

## The fake and deliberately invalid fixtures

- Before tightening a check in `test/fake-bluesky.ts`, grep for fixtures that are invalid on
  purpose: `grep -rn 'not-a-date\|createdAt: ""' test/`. Undatable likes and reposts must stay
  servable, because the age rule never deletes them and tests prove it.
- The harness types `NewLike` and `NewRepost` (exported by the fake) require `createdAt`. Tests add
  a record without one through a cast (`{ subject } as unknown as NewRepost`), as in
  `test/contract/fake.test.ts`.
- A served record must omit a missing `createdAt`, not carry `createdAt: undefined`; the fake's own
  response validation rejects the latter.

## Request budget

- Per collection, listing costs `ceil(n / 100) + 1` requests (every non-empty page has a cursor,
  then one empty page ends it). Add 1 `createSession` when anything is old, and
  `ceil(old / 200)` `applyWrites` per collection. The Free plan allows 50 requests per run, and the
  specs escalate above 45.
- `task count` prints these numbers for the live account (read-only, public endpoint). Use it for
  spec numbers instead of hand counting.

## Verifying a deployed run

- Every push to `main` deploys, and the next 03:00 UTC run deletes for real.
- Run `task count -- --at <next run time>` before the run and `task count` after it. The script
  lists records independently of `src/`, so a broken listing in the Worker does not hide old
  records from it. Cross-check with the `Deleted X of X …` lines in Workers Logs (dashboard only,
  3 days).

## Agentic-CD sessions in this repository

- Send each user answer to the orchestrator in the same message that resumes it, or it asks again.
- Verify every checkpoint from disk, not from the report: `git status --short`, then
  `task test >/dev/null 2>&1; echo $?`. Piping `task test` into `tail` hides its exit code.
- A subagent report can be lost: the harness refuses a second hand-back in one result. When that
  happens, rebuild the checkpoint from `git diff --cached` and a test run.
- An orchestrator or review orchestrator can return before its own background agents finish (it
  reports "waiting on its own background work", or a review says "not complete"). Wait for the
  completion notification, then resume it with SendMessage so it can aggregate. Stop an
  orchestrator with TaskStop once its work is staged and verified, so a late phase agent cannot
  write over reviewed files. `review-diff.sh --check-pass` before each commit catches such writes.
- A blocked chunk with finished steps still gets its own review and commit before the remaining
  step runs; cycles 3 and 4 were committed while cycle 5 waited on a decision.
- A decision that changes the spec is an edit to its Musts plus an `Amendment` line in its decision
  log. `specs/` is gitignored, so the amendment lives only on this machine.
