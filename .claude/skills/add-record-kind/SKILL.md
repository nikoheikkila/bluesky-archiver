---
name: add-record-kind
description: Checklist for adding a new Bluesky record kind (for example posts) to the daily deletion run in bluesky-archiver, based on how reposts were added after likes. Use when specifying or implementing a slice that makes the Worker list or delete another collection, when extending the fake Bluesky server to a new collection, or when estimating the request budget of a new kind.
---

# Adding a record kind to the daily run

Likes came first, reposts were added in the `delete-old-reposts` slice, and posts with their reply
settings and quote settings in the `delete-old-posts` slice. This checklist records what those
slices needed, in the order that kept every chunk safe to deploy.

## 1. Measure before specifying

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

- `src/domain-types.ts`: add the record type to the `SubjectRecord` union, which extends `Collection`.
  Records without a `subject` do not fit `SubjectRecord`; the posts slice has widened the type, so
  such a kind only joins `Collection` and is typed as a dated record (see the notes below).
- `src/report.ts`: extend `RecordNoun`. `formatRecordLine` prints `deleting <noun> <record URI>`
  from the record's own `uri`, so it fits any kind, subject or not.
- `src/select.ts` (`selectOldRecords`) and `src/delete.ts` (`deleteRecords`) take any collection
  as they are.

## 4. Wiring

- `src/worker.ts`: `OldRecordsCleaner.run()` calls `clean(collection, noun, runStart)` once per
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

- `AGENTS.md`: "What this is", the Architecture pipeline, the fake paragraph (cycle 1), and the
  Constraints on which collections `listRecords` and `applyWrites` may name (wiring cycle).
- `README.md`: what gets deleted.

## Notes from the posts slice

- A kind with no `subject` (posts, threadgates, postgates) needs the record type widened from
  `SubjectRecord` to a dated record. That is done in `src/bluesky.ts` and `src/domain-types.ts`.
- The fake must learn the kind's collection, with the same paging as likes, and validate its
  records against the `@bsky/sdk` lexicon, allowing a missing or malformed `createdAt`.
- Subject posts that likes and reposts point at belong to another account and must not appear in
  the account's own listing. Seed the account's own posts through separate harness methods.
- Settings are judged by their own `createdAt`, not by their post: they can be younger than the
  post and outlive it, and old settings of a post deleted by hand still go.
- The contract suites in `test/contract/` must cover listing and deletion of the new kind. Their
  forbidden-delete case must name a collection no kind uses (it became `app.bsky.actor.profile`).
- A new kind in the run adds an info line to every run that reaches the end and changes request
  counts in the tests that pin the whole run. Find them by grep (section 5).
