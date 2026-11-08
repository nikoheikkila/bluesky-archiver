import { listLikes } from "./bluesky";
import { selectOldLikes } from "./select";
import { formatReport } from "./report";

export interface Env {
  BLUESKY_DID: string;
  BLUESKY_SERVER_URL: string;
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const likes = await listLikes({ baseUrl: env.BLUESKY_SERVER_URL, did: env.BLUESKY_DID });
    const lines = formatReport(selectOldLikes(likes, controller.scheduledTime));
    for (const line of lines) {
      console.log(line);
    }
  },
};
