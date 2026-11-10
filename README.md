# Bluesky Archiver

A Cloudflare Worker that prunes old activity from one Bluesky account (`nikoheikkila.fi`). Every
day at 03:00 UTC it permanently deletes the account's likes, reposts, posts, reply settings and
quote settings that are more than one year old. This limits the public exposure of past activity
and reduces the risk of online harassment.

## What gets deleted

| Record                                                                         | Deleted                       |
| ------------------------------------------------------------------------------ | ----------------------------- |
| Likes (`app.bsky.feed.like`)                                                   | Yes, when older than one year |
| Reposts (`app.bsky.feed.repost`), including reposts of the account's own posts | Yes, when older than one year |
| Posts, including replies and quote posts (`app.bsky.feed.post`)                | Yes, when older than one year |
| Reply settings (`app.bsky.feed.threadgate`: who can reply, hidden replies)     | Yes, when older than one year |
| Quote settings (`app.bsky.feed.postgate`: who can quote, detached quotes)      | Yes, when older than one year |

- **Older than one year** means the record's own `createdAt` is more than 365 × 24 hours before the
  run starts, in UTC. A like or repost of a post that has since been deleted is judged by its own
  date too, and so are a post's reply settings and quote settings: they can outlive their post by
  the gap between the two creation times.
- A record with a missing or unreadable `createdAt` is never deleted.
- Deletion is permanent. Nothing is archived, and there is no dry-run mode or off switch. Copies
  that other services already received through the Bluesky firehose stay where they are.
- Other people's replies to and quotes of a deleted post stay and point at a post that no longer
  exists. Media files of deleted posts are left to the server to clean up.
- The pinned post is not yet protected: a pinned post older than one year is deleted. Protecting it
  is the next slice, due before 2027-08-15.

## How a run works

For likes, then reposts, posts, reply settings and quote settings, in that order, the Worker:

1. lists every record of the collection through the public `com.atproto.repo.listRecords`
   endpoint;
2. picks the records older than one year, oldest first;
3. logs in with an app password, at most once per run and only when something is old;
4. deletes them with `com.atproto.repo.applyWrites`, at most 200 per request;
5. logs one line per deleted record (`deleting <kind> <URI of the deleted record>`), then a total
   such as `Deleted 3 of 3 reposts older than one year`.

If any request fails, the run stops with an error, and the next day's run deletes the rest. A
failure in one kind never undoes what the kinds before it already deleted that day. Each request
times out after 10 seconds, and a request that takes longer is aborted and counts as a failure.
Listing all five kinds takes 37 requests in total; a day that deletes from three kinds
makes about 41, and the Workers Free plan allows 50. The listings of all five kinds share that cap.
A run exceeds 50 requests from 1,801 posts on a day its deletions fit one batch, and from 1,201
posts when every post is old, because deleting more than 200 posts takes more than one batch. The
Request Budget section of AGENTS.md has the formula and the other cases.

## Requirements

- [Bun](https://bun.sh) (package manager) and [go-task](https://taskfile.dev)
  (`brew install go-task`).
- The [1Password CLI](https://developer.1password.com/docs/cli/) (`op`). `.env` holds `op://`
  references to the secrets, never the values.
- A Cloudflare account on the Workers Free plan.

## Setup and deployment

```bash
bun install          # also installs the Lefthook pre-commit hook
task check           # lint, typecheck and tests, as CI runs them
```

The account's DID and server URL are Wrangler `vars` in `wrangler.jsonc`. The app password is a
Worker secret. Set it by piping the value from 1Password, because the interactive prompt does not
work under `op run`:

```bash
op run --env-file=.env -- sh -c 'printf %s "$BLUESKY_APP_PASSWORD" | bunx wrangler secret put BLUESKY_APP_PASSWORD'
```

Every push to `main` runs the checks in GitHub Actions and then deploys with `wrangler deploy`. The
next 03:00 UTC run after a push deletes for real.

## Checking the daily run

```bash
task logs                                    # stream the deployed Worker's logs live
```

`task logs` shows only live invocations, so start it before 03:00 UTC. For past runs, use Workers Logs in the
Cloudflare dashboard, which keeps 3 days on the Free plan.

## Development

- `task test` runs the Vitest suite inside the Workers runtime. Every test runs against an
  in-process fake Bluesky server (`test/fake-bluesky.ts`), and no test reaches the real one.
- Work is spec-driven. Each change starts as a spec with one Gherkin scenario (`feature/`) and a
  plan of TDD cycles; the specs themselves stay local. `AGENTS.md` describes the architecture
  and working rules for coding agents.

## License

MIT. See [LICENSE](LICENSE).
