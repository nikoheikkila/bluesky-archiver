# Lexicon Validation and Deliberately Invalid Fixtures

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
