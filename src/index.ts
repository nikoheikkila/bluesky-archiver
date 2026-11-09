import { type Collection, LIKE_COLLECTION, listRecords, type SubjectRecord } from "./bluesky";
import { deleteRecords } from "./delete";
import { formatDeletionSummary, formatRecordLine, type RecordNoun } from "./report";
import { selectOldRecords } from "./select";
import { login } from "./session";

const REPOST_COLLECTION: Collection = "app.bsky.feed.repost";

export interface Env {
  BLUESKY_DID: string;
  BLUESKY_SERVER_URL: string;
  // A missing Worker secret is rejected before listing.
  BLUESKY_APP_PASSWORD?: string;
}

class OldRecordsCleaner {
  private readonly password: string;

  constructor(private readonly env: Env) {
    this.password = OldRecordsCleaner.requirePassword(env);
  }

  private session?: Awaited<ReturnType<typeof login>>;

  async run(runStart: number): Promise<void> {
    await this.clean(LIKE_COLLECTION, "like", runStart);
    await this.clean(REPOST_COLLECTION, "repost", runStart);
  }

  private async clean(collection: Collection, noun: RecordNoun, runStart: number): Promise<void> {
    const records = await this.fetchRecords(collection);
    const { old, skipped } = selectOldRecords(records, runStart);
    const deleted = await this.deleteOld(collection, old);
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
    });
  }

  private login() {
    return login({
      baseUrl: this.env.BLUESKY_SERVER_URL,
      did: this.env.BLUESKY_DID,
      password: this.password,
    });
  }

  private async deleteOld(collection: Collection, old: SubjectRecord[]): Promise<number> {
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
        deleted += this.logDeleted(batch);
      },
    });
    return deleted;
  }

  private logDeleted(batch: SubjectRecord[]): number {
    for (const record of batch) {
      console.log(formatRecordLine(record));
    }
    return batch.length;
  }

  private report(summary: Parameters<typeof formatDeletionSummary>[0], noun: RecordNoun): void {
    for (const line of formatDeletionSummary(summary, noun)) {
      console.log(line);
    }
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await new OldRecordsCleaner(env).run(controller.scheduledTime);
  },
};
