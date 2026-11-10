import { type Fetch, LIKE_COLLECTION, listRecords } from "./bluesky";
import { deleteRecords } from "./delete";
import type { Collection, RecordIn } from "./domain-types";
import { readPinnedPost, withoutPinnedPost } from "./profile";
import { formatDeletionSummary, formatRecordLine, type RecordNoun } from "./report";
import { selectOldRecords } from "./select";
import { login } from "./session";
import { withRequestTimeout } from "./timeout";

const REPOST_COLLECTION = "app.bsky.feed.repost" satisfies Collection;
const POST_COLLECTION = "app.bsky.feed.post" satisfies Collection;
const THREADGATE_COLLECTION = "app.bsky.feed.threadgate" satisfies Collection;
const POSTGATE_COLLECTION = "app.bsky.feed.postgate" satisfies Collection;

export interface Env {
  BLUESKY_DID: string;
  BLUESKY_SERVER_URL: string;
  // A missing Worker secret is rejected before listing.
  BLUESKY_APP_PASSWORD?: string;
}

/** A report line's level; `src/index.ts` writes it with the `console` method of the same name. */
export type LogLevel = "debug" | "info";

export interface LogEntry {
  level: LogLevel;
  message: string;
}

/**
 * The run's I/O: every request goes through `fetch` and every report line through `log`, at debug
 * for each deleted record and at info for each summary line. `createWorker` wraps `fetch` so every
 * request is aborted after `requestTimeoutMs`.
 */
export interface Dependencies {
  fetch: Fetch;
  log: (entry: LogEntry) => void;
  /** Per-request timeout in milliseconds; defaults to REQUEST_TIMEOUT_MS, 10 seconds. */
  requestTimeoutMs?: number;
}

class OldRecordsCleaner {
  private readonly password: string;

  constructor(
    private readonly env: Env,
    private readonly deps: Dependencies,
  ) {
    this.password = OldRecordsCleaner.requirePassword(env);
  }

  private session?: Awaited<ReturnType<typeof login>>;

  async run(runStart: number): Promise<void> {
    const pinnedUri = await this.pinnedPostUri();
    await this.clean(LIKE_COLLECTION, "like", runStart);
    await this.clean(REPOST_COLLECTION, "repost", runStart);
    await this.clean(POST_COLLECTION, "post", runStart, pinnedUri);
    await this.clean(THREADGATE_COLLECTION, "reply settings", runStart);
    await this.clean(POSTGATE_COLLECTION, "quote settings", runStart);
  }

  private async clean<C extends Collection>(
    collection: C,
    noun: RecordNoun,
    runStart: number,
    pinnedUri?: string,
  ): Promise<void> {
    const records = withoutPinnedPost(await this.fetchRecords(collection), pinnedUri);
    const { old, skipped } = selectOldRecords(records, runStart);
    const deleted = await this.deleteOld(collection, noun, old);
    this.report({ found: old.length, deleted, skipped }, noun);
  }

  private static requirePassword(env: Env): string {
    if (!env.BLUESKY_APP_PASSWORD) {
      throw new Error("BLUESKY_APP_PASSWORD is not set");
    }
    return env.BLUESKY_APP_PASSWORD;
  }

  private fetchRecords<C extends Collection>(collection: C) {
    return listRecords({
      baseUrl: this.env.BLUESKY_SERVER_URL,
      did: this.env.BLUESKY_DID,
      collection,
      fetch: this.deps.fetch,
    });
  }

  private pinnedPostUri() {
    return readPinnedPost({
      baseUrl: this.env.BLUESKY_SERVER_URL,
      did: this.env.BLUESKY_DID,
      fetch: this.deps.fetch,
    });
  }

  private login() {
    return login({
      baseUrl: this.env.BLUESKY_SERVER_URL,
      did: this.env.BLUESKY_DID,
      password: this.password,
      fetch: this.deps.fetch,
    });
  }

  private async deleteOld<C extends Collection>(
    collection: C,
    noun: RecordNoun,
    old: RecordIn<C>[],
  ): Promise<number> {
    if (old.length === 0) {
      return 0;
    }
    if (!this.session) {
      this.session = await this.login();
    }
    const session = this.session;
    let deleted = 0;
    await deleteRecords(collection, old, {
      did: this.env.BLUESKY_DID,
      fetchHandler: session.fetchHandler,
      onBatchDeleted: (batch) => {
        deleted += this.logDeleted(batch, noun);
      },
    });
    return deleted;
  }

  private logDeleted<C extends Collection>(batch: RecordIn<C>[], noun: RecordNoun): number {
    for (const record of batch) {
      this.deps.log({ level: "debug", message: formatRecordLine(record, noun) });
    }
    return batch.length;
  }

  private report(summary: Parameters<typeof formatDeletionSummary>[0], noun: RecordNoun): void {
    for (const message of formatDeletionSummary(summary, noun)) {
      this.deps.log({ level: "info", message });
    }
  }
}

/** Builds the Worker's handlers around the given I/O; `src/index.ts` passes the real ones. */
export function createWorker(deps: Dependencies) {
  const timedDeps: Dependencies = {
    fetch: withRequestTimeout(deps.fetch, deps.requestTimeoutMs),
    log: deps.log,
  };
  return {
    async scheduled(controller: { scheduledTime: number }, env: Env): Promise<void> {
      await new OldRecordsCleaner(env, timedDeps).run(controller.scheduledTime);
    },
  };
}
