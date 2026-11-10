// Feature: feature/keep-pinned-post.feature
// Scenario: Daily run keeps the pinned post when every other post is deleted
import { createScheduledController, env } from "cloudflare:test";
import { expect, test } from "vitest";
import { createWorker, type LogEntry } from "../src/worker";
import { DAY, HOUR, YEAR } from "./constants";
import { createFakeBluesky } from "./fake-bluesky";

const APP_PASSWORD = "test-app-password";

test("Daily run keeps the pinned post when every other post is deleted", async () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const createdBefore = (ms: number) => new Date(runStart - ms).toISOString();

  const bluesky = createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: APP_PASSWORD,
  });
  const music = bluesky.addPost("a post about music");
  const elections = bluesky.addAccountPost({
    kind: "plain",
    text: "a post about elections",
    createdAt: createdBefore(2 * YEAR),
  });
  const welcome = bluesky.addAccountPost({
    kind: "plain",
    text: "a welcome post",
    createdAt: createdBefore(400 * DAY),
  });
  const reply = bluesky.addAccountPost({
    kind: "reply",
    text: "a reply about music",
    createdAt: createdBefore(YEAR + HOUR),
    parent: music.uri,
  });
  bluesky.pinPost(welcome);
  const entries: LogEntry[] = [];
  const worker = createWorker({
    fetch: bluesky.fetch,
    log: (entry) => {
      entries.push(entry);
    },
  });
  const workerEnv = { ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD };

  const controller = createScheduledController({ scheduledTime: runStart });
  await worker.scheduled(controller, workerEnv);

  expect(entries).toStrictEqual([
    { level: "info", message: "No likes are older than one year" },
    { level: "info", message: "No reposts are older than one year" },
    { level: "debug", message: `deleting post ${elections.uri}` },
    { level: "debug", message: `deleting post ${reply.uri}` },
    { level: "info", message: "Deleted 2 of 2 posts older than one year" },
    { level: "info", message: "No reply settings are older than one year" },
    { level: "info", message: "No quote settings are older than one year" },
  ]);
  expect(bluesky.accountPosts().map((post) => post.uri)).toStrictEqual([welcome.uri]);
});
