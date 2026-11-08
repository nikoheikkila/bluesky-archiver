export interface Env {
  BLUESKY_DID: string;
  BLUESKY_SERVER_URL: string;
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {},
};
