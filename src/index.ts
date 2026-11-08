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

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.BLUESKY_APP_PASSWORD) {
      throw new Error("BLUESKY_APP_PASSWORD is not set");
    }
    const likes = await listLikes({ baseUrl: env.BLUESKY_SERVER_URL, did: env.BLUESKY_DID });
    const { old, skipped } = selectOldLikes(likes, controller.scheduledTime);
    let deleted = 0;
    if (old.length > 0) {
      const session = await login({
        baseUrl: env.BLUESKY_SERVER_URL,
        did: env.BLUESKY_DID,
        password: env.BLUESKY_APP_PASSWORD,
      });
      await deleteLikes(old, {
        did: env.BLUESKY_DID,
        fetchHandler: session.fetchHandler,
        onBatchDeleted: (batch) => {
          for (const like of batch) {
            console.log(formatLikeLine(like));
            deleted++;
          }
        },
      });
    }
    const lines = formatDeletionSummary({ found: old.length, deleted, skipped });
    for (const line of lines) {
      console.log(line);
    }
  },
};
