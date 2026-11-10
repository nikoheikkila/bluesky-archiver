import { type Fetch, LIKE_COLLECTION, listRecords } from "./bluesky";
import { deleteRecords } from "./delete";
import type { Collection, SubjectRecord } from "./domain-types";
import { formatDeletionSummary, formatRecordLine, type RecordNoun } from "./report";
import { selectOldRecords } from "./select";
import { login } from "./session";

const REPOST_COLLECTION: Collection = "app.bsky.feed.repost";
const POST_COLLECTION: Collection = "app.bsky.feed.post";
const THREADGATE_COLLECTION: Collection = "app.bsky.feed.threadgate";
const POSTGATE_COLLECTION: Collection = "app.bsky.feed.postgate";

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
 * for each deleted record and at info for each summary line.
 */
export interface Dependencies {
  fetch: Fetch;
  log: (entry: LogEntry) => void;
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
    await this.clean(LIKE_COLLECTION, "like", runStart);
    await this.clean(REPOST_COLLECTION, "repost", runStart);
    await this.clean(POST_COLLECTION, "post", runStart);
    await this.clean(THREADGATE_COLLECTION, "reply settings", runStart);
    await this.clean(POSTGATE_COLLECTION, "quote settings", runStart);
  }

  private async clean(collection: Collection, noun: RecordNoun, runStart: number): Promise<void> {
    const records = await this.fetchRecords(collection);
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

  private fetchRecords(collection: Collection) {
    return listRecords({
      baseUrl: this.env.BLUESKY_SERVER_URL,
      did: this.env.BLUESKY_DID,
      collection,
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

  private async deleteOld(
    collection: Collection,
    noun: RecordNoun,
    old: SubjectRecord[],
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

  private logDeleted(batch: SubjectRecord[], noun: RecordNoun): number {
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
  return {
    async scheduled(controller: { scheduledTime: number }, env: Env): Promise<void> {
      await new OldRecordsCleaner(env, deps).run(controller.scheduledTime);
    },
  };
}
