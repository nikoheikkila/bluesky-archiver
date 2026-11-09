---

name: add-record-kind
description: Checklist for adding a new Bluesky record kind (for example posts) to the daily deletion run in bluesky-archiver, based on how reposts were added after likes. Use when specifying or implementing a slice that makes the Worker list or delete another collection, when extending the fake Bluesky server to a new collection, or when estimating the request budget of a new kind.
---

# Adding a record kind to the daily run

Likes came first, and reposts were added in the `delete-old-reposts` slice. Posts are next. This
checklist records what that slice needed, in the order that kept every chunk safe to deploy.

## 1. Measure before specifying

- `task count -- --at <next 03:00 UTC> <nsid>` lists the collection through the public endpoint.
  It prints the total, the number older than one year, undatable records and listing requests.
  `task count` with no collection gives the whole run's budget for likes and reposts.
- Budget per collection: `ceil(n / 100) + 1` listing requests, plus `ceil(old / 200)`
  `applyWrites`, plus one shared `createSession`. Stop and ask above 45 in total (the Free plan
  allows 50).

## 2. Fake and contract first (the riskiest cycle)

- `test/fake-bluesky.ts`: store the kind, add storage-only harness methods (`add<Kind>()`, the
  bulk `add<Kind>s()` for seeding without loops, and `<kind>s()`) in the acceptance step so the
  acceptance test compiles, then serve it through
  `listRecords` with the same paging as likes (a cursor on every non-empty page, then an empty page
  without one), and accept its deletes in `applyWrites`.
- Validate every served record against its record lexicon from `@bsky/sdk`, keeping the
  `createdAt` exemption: a missing or malformed `createdAt` must still be served, and omitted
  rather than sent as `undefined`.
- `test/contract/` cases: 150 records page as 100, 50, then an empty page; deleting 2 of 3 leaves the
  third; a delete of a collection outside the allowed ones gets HTTP 400 and deletes nothing; a
  record that breaks its lexicon fails; undatable records are served as stored.
- Change the fake only together with its contract.

## 3. Shared modules

The pipeline is already collection-agnostic. A new kind needs these changes:

- `src/bluesky.ts`: add the record type to the `SubjectRecord` union, which extends `Collection`.
  Records without a `subject` (posts) do not fit `SubjectRecord`, so posts need a wider record type.
- `src/report.ts`: extend `RecordNoun`. `formatRecordLine` prints `<createdAt> <subject URI>`, so a
  kind without a subject needs its own line format, fixed in the spec.
- `src/select.ts` (`selectOldRecords`) and `src/delete.ts` (`deleteRecords`) take any collection
  as they are.

## 4. Wiring

- `src/index.ts`: `OldRecordsCleaner.run()` calls `clean(collection, noun, runStart)` once per
  kind, in order. Add the new kind after the existing ones. The session is shared, so login still
  happens at most once, and a failure stops the kinds that follow.
- Only this cycle changes what the deployed Worker does, so keep it last and commit it on its own.

## 5. Existing tests that will change

Every run that reaches the end gains a final `No <kind>s are older than one year` line, and every
request count gains the new listing requests. List the affected tests in the spec from grep, not
from memory:

```bash
grep -n 'are older than one year"' test/*.test.ts
grep -n 'requests' test/scheduled.test.ts
```

## 6. Documentation in the same cycles

- `CLAUDE.md`: "What this is", the Architecture pipeline, the fake paragraph (cycle 1), and the
  Constraints on which collections `listRecords` and `applyWrites` may name (wiring cycle).
- `README.md`: what gets deleted.

## Notes for the posts slice

- Today `app.bsky.feed.post` is forbidden everywhere. The Constraints in `CLAUDE.md` exclude it,
  the fake rejects deleting it, and `test/scheduled.test.ts` asserts that no request names it (the
  quote-post test). A posts slice must change each of these on purpose.
- The pinned post must be kept. It is referenced from the profile record (`app.bsky.actor.profile`,
  `pinnedPost`); confirm against the lexicon in `@bsky/sdk` before relying on it.
- Replies and quote posts are `app.bsky.feed.post` records too.
