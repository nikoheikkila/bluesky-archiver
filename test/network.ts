import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { setupNetwork } from "@msw/cloudflare";
import { http } from "msw";
import worker from "../src/index";
import { rkeyOf } from "./constants";
import { createFakeBluesky, type FakeBluesky } from "./fake-bluesky";

// The suite's one network interceptor (enabled in test/setup/network.ts). It patches the runtime's
// global fetch, so the real Worker entry point (src/index.ts) runs against the fake; a request no
// handler matches fails the test instead of reaching the network.
export const network = setupNetwork();

/** A fake of the Bluesky account the Worker's own env names, accepting its app password. */
export function createEnvBluesky(): FakeBluesky {
  return createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: env.BLUESKY_APP_PASSWORD,
  });
}

/** Routes every request to the configured Bluesky server through the fake. */
export function serveBluesky(bluesky: FakeBluesky): void {
  network.use(
    http.all(`${env.BLUESKY_SERVER_URL}/*`, ({ request }) =>
      bluesky.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }),
    ),
  );
}

/**
 * Runs the deployed Worker's scheduled handler at `runStart` with the Worker's own env, as the
 * daily cron does. A failed run rejects.
 */
export async function runDailyWorker(runStart: number): Promise<void> {
  await worker.scheduled(createScheduledController({ scheduledTime: runStart }), env);
}

/** The one applyWrites batch that deletes these records of `collection`, as the fake records it. */
export function deletesOf(collection: string, records: { uri: string }[]) {
  return records.map((record) => ({
    $type: "com.atproto.repo.applyWrites#delete",
    collection,
    rkey: rkeyOf(record.uri),
  }));
}
