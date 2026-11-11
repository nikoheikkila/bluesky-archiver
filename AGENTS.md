# AGENTS.md

Guidance for coding agents working in this repository: what the Worker does, the commands, the
architecture, the constraints, and the pitfalls learned in earlier sessions.

## What This Is

A Cloudflare Worker (TypeScript, Wrangler) that runs daily at 03:00 UTC against one Bluesky account
(DID and server URL are Wrangler `vars` in `wrangler.jsonc`). Each run permanently deletes the
account's likes, reposts, posts (plain posts, replies, and quote posts), reply settings
(`app.bsky.feed.threadgate`) and quote settings (`app.bsky.feed.postgate`) that are older than one
year (the age rule is under [Constraints](#constraints)).

No mode or flag turns
deletion off. Reposts are direct `app.bsky.feed.repost` records only. The pinned post is kept while
it stays pinned, no matter how old; if the user unpins it or pins another post, the next daily run
deletes it. Its reply settings and quote settings are still deleted by the age rule.

## Commands

Bun is the package manager; [go-task](https://taskfile.dev) (`brew install go-task`) is the script
runner. Tasks live in `Taskfile.yml`; `package.json` keeps only the `prepare` lifecycle hook.

```bash
task install                                # installs packages with Bun
task test                                   # default suite (Vitest inside workerd via @cloudflare/vitest-plugin)
task test -- test/select.test.ts            # one file
task test -- -t "exactly one year"          # one test by name
task typecheck                              # wrangler types → src/cloudflare.d.ts, then tsc --noEmit
task lint                                   # Biome format + lint + import order (strict)
task format                                 # applies Biome fixes and formatting
task check                                  # lint + typecheck + test + incremental mutation tests
task mutation                               # full Stryker run (slow; end-of-phase gate only)
task mutation:incremental                   # Stryker reusing reports/stryker-incremental.json
task mutation:diff [-- <base>]              # mutate only src/ files changed against the base branch (clean tree required)
task dry-run                                # build the bundle without deploying
task logs                                   # stream the deployed Worker's logs, pretty-printed (needs the 1Password CLI)
task logs:json                              # same as JSON lines, for agents and jq
task logs:errors                            # only failed invocations
```

CI (`.github/workflows/deploy.yml`) runs on every push to `main`: the `test` job runs `task lint`,
`task typecheck`, `task test` and `task mutation:incremental` (with
`reports/stryker-incremental.json` cached), then the `deploy` job deploys with
`cloudflare/wrangler-action@v4` (reusing the locked `wrangler` devDependency) using the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

### Version Control

This project uses Trunk-Based Development. Commits and pushes to `main` branch are allowed **if and only if** the
commit hooks pass. Never create a new feature branch unless the user explicitly tells you to.

### Further Reading

Read the following files progressively depending on the further knowledge required:

- [Architecture](.claude/instructions/architecture.md)
- [Bluesky Lexicon](.claude/instructions/lexicon.md)
- [Logs](.claude/instructions/logs.md)
- [Testing](.claude/instructions/testing.md)
- [Mutation testing](.claude/instructions/mutation-testing.md)
