import { listLikes } from "./bluesky";
import { selectOldLikes } from "./select";
import { formatLikeLine, formatDeletionSummary } from "./report";
import { login } from "./session";
import { deleteLikes } from "./delete";

export interface Env {
  BLUESKY_DID: string;
  BLUESKY_SERVER_URL: string;
  // A missing Worker secret is rejected before listing.
  BLUESKY_APP_PASSWORD?: string;
}

type Like = Awaited<ReturnType<typeof listLikes>>[number];

class OldLikesCleaner {
  private readonly password: string;

  constructor(private readonly env: Env) {
    this.password = OldLikesCleaner.requirePassword(env);
  }

  async run(runStart: number): Promise<void> {
    const likes = await this.fetchLikes();
    const { old, skipped } = selectOldLikes(likes, runStart);
    const deleted = await this.deleteOld(old);
    this.report({ found: old.length, deleted, skipped });
  }

  private static requirePassword(env: Env): string {
    if (!env.BLUESKY_APP_PASSWORD) {
      throw new Error("BLUESKY_APP_PASSWORD is not set");
    }
    return env.BLUESKY_APP_PASSWORD;
  }

  private fetchLikes() {
    return listLikes({ baseUrl: this.env.BLUESKY_SERVER_URL, did: this.env.BLUESKY_DID });
  }

  private login() {
    return login({
      baseUrl: this.env.BLUESKY_SERVER_URL,
      did: this.env.BLUESKY_DID,
      password: this.password,
    });
  }

  private async deleteOld(old: Like[]): Promise<number> {
    if (old.length === 0) {
      return 0;
    }
    const session = await this.login();
    let deleted = 0;
    await deleteLikes(old, {
      did: this.env.BLUESKY_DID,
      fetchHandler: session.fetchHandler,
      onBatchDeleted: (batch) => {
        deleted += this.logDeleted(batch);
      },
    });
    return deleted;
  }

  private logDeleted(batch: Like[]): number {
    for (const like of batch) {
      console.log(formatLikeLine(like));
    }
    return batch.length;
  }

  private report(summary: Parameters<typeof formatDeletionSummary>[0]): void {
    for (const line of formatDeletionSummary(summary)) {
      console.log(line);
    }
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await new OldLikesCleaner(env).run(controller.scheduledTime);
  },
};
