import { type Fetch, listRecords, type Repo } from "./bluesky";
import { deleteRecords } from "./delete";
import type { Collection } from "./domain-types";
import { readPinnedPost, withoutPinnedPost } from "./profile";
import { type RecordNoun, type ReportEntry, recordEntry, summaryEntries } from "./report";
import { selectOldRecords } from "./select";
import { type AuthorisedSession, login } from "./session";
import { withRequestTimeout } from "./timeout";

/** The kinds a run cleans, in run order. */
const KINDS: readonly { collection: Collection; noun: RecordNoun }[] = [
  { collection: "app.bsky.feed.like", noun: "like" },
  { collection: "app.bsky.feed.repost", noun: "repost" },
  { collection: "app.bsky.feed.post", noun: "post" },
  { collection: "app.bsky.feed.threadgate", noun: "reply settings" },
  { collection: "app.bsky.feed.postgate", noun: "quote settings" },
];

/** A report line's level; `src/index.ts` writes it with the `console` method of the same name. */
export type LogLevel = "debug" | "info";

/** A report line at its level; `src/index.ts` writes it as one JSON line of message and fields. */
export interface LogEntry extends ReportEntry {
  level: LogLevel;
}

type Log = (entry: LogEntry) => void;

/**
 * The run's I/O: every request goes through `fetch` and every report line through `log`, at debug
 * for each deleted record and at info for each summary line. `createWorker` wraps `fetch` so every
 * request is aborted after `requestTimeoutMs`.
 */
export interface Dependencies {
  fetch: Fetch;
  log: Log;
  /** Per-request timeout in milliseconds; defaults to REQUEST_TIMEOUT_MS, 10 seconds. */
  requestTimeoutMs?: number;
}

async function run(env: Env, fetch: Fetch, log: Log, runStart: number): Promise<void> {
  // The generated Env declares the secret, but a Worker without it set is rejected before listing.
  const password = env.BLUESKY_APP_PASSWORD;
  if (!password) {
    throw new Error("BLUESKY_APP_PASSWORD is not set");
  }
  const repo: Repo = { baseUrl: env.BLUESKY_SERVER_URL, did: env.BLUESKY_DID, fetch };
  const pinnedUri = await readPinnedPost(repo);
  let session: AuthorisedSession | undefined;

  for (const { collection, noun } of KINDS) {
    // The pinned URI names a post, so it can only ever match in the posts collection.
    const records = withoutPinnedPost(await listRecords({ ...repo, collection }), pinnedUri);
    const { old, skipped } = selectOldRecords(records, runStart);
    if (old.length > 0) {
      // Log in at most once, and only when something is old.
      session ??= await login({ ...repo, password });
      await deleteRecords(collection, old, {
        did: repo.did,
        fetchHandler: session.fetchHandler,
        onBatchDeleted: (batch) => {
          for (const record of batch) {
            log({ level: "debug", ...recordEntry(record, noun) });
          }
        },
      });
    }
    // deleteRecords throws on any failed batch, so reaching here means every old record went.
    const summary = { found: old.length, deleted: old.length, skipped };
    for (const entry of summaryEntries(summary, noun)) {
      log({ level: "info", ...entry });
    }
  }
}

/** Builds the Worker's handlers around the given I/O; `src/index.ts` passes the real ones. */
export function createWorker({ fetch, log, requestTimeoutMs }: Dependencies) {
  const timedFetch = withRequestTimeout(fetch, requestTimeoutMs);
  return {
    async scheduled(controller: ScheduledController, env: Env): Promise<void> {
      await run(env, timedFetch, log, controller.scheduledTime);
    },
  };
}
