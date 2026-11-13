# Logs

The `task logs*` tasks run `scripts/tail.sh`, which wraps `wrangler tail` in a loop that reconnects
when the session expires or drops; Ctrl-C (SIGINT/SIGTERM) stops it. The loop is a bash script
because task's built-in shell does not support `trap`. `wrangler tail` is live-only (a short gap
occurs during each reconnect), so leave one running before 03:00 UTC to catch the daily run. The
token is worker-scoped with only the "Individual Workers: Editor" role on `bluesky-cleaner`: it
can deploy, set secrets and tail this Worker, but sees no other Worker (the account is shared with
the blog) and gets 403 on account-level APIs such as the audit log, members and R2. Never widen it
to the legacy account-wide "Workers Scripts" permission. It cannot query historical logs through
the API; for history use Workers Logs in the dashboard, which keeps 3 days on the Free plan.

Every report line is one JSON object: the spec's `message` wording plus its facts as fields.
A deleted record is `{ message, event: "record_deleted", kind, uri }`, a skipped line is
`{ message, event: "records_skipped", kind, skipped }`, and a kind's summary is
`{ message, event: "kind_summary", kind, found, deleted, skipped }`. `kind` is the record noun
("like", "repost", "post", "reply settings", "quote settings"). Workers Logs indexes the fields, so
filter on `event` = `kind_summary` for the summaries, on `kind`, or on `uri` to find one record. The
level still comes from the console method: `$metadata.level` = `info` for summaries, `debug` for
per-record lines. `wrangler tail` shows the same level per line (`.logs[].level` in
`task logs:json`).

Observability in `wrangler.jsonc` keeps every log line and every trace (`head_sampling_rate: 1`
for both, since the Worker runs once a day). Traces show each subrequest of a run in the dashboard.
Invocation logs are off (`invocation_logs: false`): Cloudflare's per-invocation lines such as
"bluesky-cleaner scheduled OK" and "bluesky-cleaner fetch 200" only repeated what the report lines
and traces already show.
