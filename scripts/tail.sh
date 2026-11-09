#!/usr/bin/env bash
# Tails the deployed Worker's logs and reconnects when the session expires or drops.
# Ctrl-C (SIGINT) or SIGTERM stops it for good. Usage: scripts/tail.sh [wrangler tail flags]
set -u

trap 'exit 0' INT TERM

while true; do
  op run --env-file=.env -- bunx wrangler tail "$@" || echo "tail ended, reconnecting in 2s" >&2
  sleep 2
done
