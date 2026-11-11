# Bluesky Archiver

**A Cloudflare Worker that prunes old activity from my [Bluesky account](https://bsky.app/profile/nikoheikkila.fi).**

Every day at 03:00 UTC it permanently deletes the account's likes, reposts, posts, reply settings and
quote settings that are more than one year old. This limits the public exposure of past activity
and reduces the risk of online harassment.

## What Gets Deleted

| Record                                                | Deleted                       |
| ----------------------------------------------------- | ----------------------------- |
| Likes                                                 | Yes, when older than one year |
| Reposts, including reposts of the account's own posts | Yes, when older than one year |
| Posts, including replies and quote posts              | Yes, when older than one year |
| Reply settings (who can reply, hidden replies)        | Yes, when older than one year |
| Quote settings (who can quote, detached quotes)       | Yes, when older than one year |

- **Older than one year** means the record's creation time is more than 365 × 24 hours before the
  run starts, in UTC. A like or repost of a post that has since been deleted is judged by its own
  date too. Post's reply settings and quote settings follow this: they can outlive their post by
  the gap between the two creation times.
- Deletion is permanent. Nothing is archived, and there is no dry-run mode or off switch. Copies
  that other services already received through the Bluesky firehose stay where they are.
- Other people's replies to and quotes of a deleted post stay and point at a post that no longer
  exists. Media files of deleted posts are left to the server to clean up.
- The pinned post is never deleted, however old it is, as long as it stays pinned. If you unpin an
  old post or pin another one, the next run deletes it. The pinned post's reply settings and quote
  settings are still deleted when they are older than one year.

## How a Run Works

First the Worker reads the account's profile to find the
pinned post. Then, for likes, reposts, posts, reply settings and quote settings, in that order, it:

1. Lists every record of the collection
2. Picks the records older than one year, oldest first;
3. Logs in with an app password, at most once per run and only when something is old;
4. Deletes them in a batch, at most 200 per request;
5. Logs one line per deleted record, then a total
   such as _Deleted 3 of 3 reposts older than one year_.

If any request fails, the run stops with an error, and the next day's run deletes the rest. A
failure in one kind never undoes what the kinds before it already deleted that day. A failed
profile read stops the run before anything is deleted.

## Requirements

- [Bun](https://bun.sh) (package manager) and [go-task](https://taskfile.dev)
- The [1Password CLI](https://developer.1password.com/docs/cli/) (`op`). `.env` holds `op://`
  references to the secrets, never the values.
- A Cloudflare account on the Workers Free plan.

## Setup and Deployment

```bash
task install    # also installs the Lefthook pre-commit hook
task check      # lint, typecheck and tests, as CI runs them
```

The account's identifier and server URL are Wrangler variables in `wrangler.jsonc` file.

The app password is a
Worker secret. Set it by piping the value from 1Password, because the interactive prompt does not
work under `op run`:

```bash
op run --env-file=.env -- sh -c 'printf %s "$BLUESKY_APP_PASSWORD" | bunx wrangler secret put BLUESKY_APP_PASSWORD'
```

Every push to `main` runs the checks in GitHub Actions and then deploys the Worker. The
next 03:00 UTC run after a push deletes for real.

## Checking the Daily Run

It's easiest to check the logs from Cloudflare Dashboard, but this project provides a log tail as well:

```bash
task logs   # stream the deployed Worker's logs live
```

Running `task logs` shows only live invocations, so start it before 03:00 UTC. For past runs, use Workers Logs in the
Cloudflare dashboard, which keeps 3 days on the Free plan.

## Development

Running `task test` executes the Vitest suite inside the Workers runtime. Every test runs against an
in-process fake Bluesky server, and no test reaches the real one.

## License

MIT. See [LICENSE](LICENSE).
