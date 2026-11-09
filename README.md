# Bluesky Archiver

A Cloudflare Worker that prunes old activity from one Bluesky account (`nikoheikkila.fi`). Every
day at 03:00 UTC it permanently deletes the account's likes and reposts that are more than one
year old. This limits the public exposure of past activity and reduces the risk of online
harassment.

## What gets deleted

| Record                                                                         | Deleted                       |
| ------------------------------------------------------------------------------ | ----------------------------- |
| Likes (`app.bsky.feed.like`)                                                   | Yes, when older than one year |
| Reposts (`app.bsky.feed.repost`), including reposts of the account's own posts | Yes, when older than one year |
| Posts, replies and quote posts (`app.bsky.feed.post`)                          | Not yet; planned              |

- **Older than one year** means the record's own `createdAt` is more than 365 × 24 hours before the
  run starts, in UTC. A like or repost of a post that has since been deleted is judged by its own
  date too.
- A record with a missing or unreadable `createdAt` is never deleted.
- Deletion is permanent. Nothing is archived, and there is no dry-run mode or off switch. Copies
  that other services already received through the Bluesky firehose stay where they are.

## How a run works

For likes first, then reposts, the Worker:

1. lists every record of the collection through the public `com.atproto.repo.listRecords`
   endpoint;
2. picks the records older than one year, oldest first;
3. logs in with an app password, at most once per run and only when something is old;
4. deletes them with `com.atproto.repo.applyWrites`, at most 200 per request;
5. logs one line per deleted record (`<createdAt> <URI of the liked or reposted post>`), then a
   total such as `Deleted 3 of 3 reposts older than one year`.

If any request fails, the run stops with an error, and the next day's run deletes the rest. A
failure while deleting reposts never undoes that day's likes. A run sends about 31 requests at the
current backlog; the Workers Free plan allows 50.

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
task count                                   # likes and reposts older than one year right now, and the requests a run would send
task count -- --at 2026-11-10T03:00:00Z      # the same, judged at a given run start
task logs                                    # stream the deployed Worker's logs live
```

`task count` reads the public endpoint without logging in, independently of the Worker's code.
After a successful run, it should find nothing older than one year at that run's start. `task logs`
shows only live invocations, so start it before 03:00 UTC. For past runs, use Workers Logs in the
Cloudflare dashboard, which keeps 3 days on the Free plan.

## Development

- `task test` runs the Vitest suite inside the Workers runtime. Every test runs against an
  in-process fake Bluesky server (`test/fake-bluesky.ts`), and no test reaches the real one.
- Do not trigger the scheduled handler under `task dev`: it would delete from the real account.
- Work is spec-driven. Each change starts as a spec with one Gherkin scenario (`feature/`) and a
  plan of TDD cycles; the specs themselves stay local. `CLAUDE.md` and `AGENTS.md` describe the
  architecture and working rules for coding agents.

## License

MIT. See [LICENSE](LICENSE).
