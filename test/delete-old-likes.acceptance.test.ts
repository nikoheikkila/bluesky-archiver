// Feature: feature/delete-old-likes.feature
// Scenario: Daily run deletes only likes older than one year
import { createScheduledController, env } from "cloudflare:test";
import { expect, test } from "vitest";
import { createWorker, type LogEntry } from "../src/worker";
import { createFakeBluesky } from "./fake-bluesky";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
const APP_PASSWORD = "test-app-password";

test("Daily run deletes only likes older than one year", async () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const createdBefore = (ms: number) => new Date(runStart - ms).toISOString();

  const bluesky = createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: APP_PASSWORD,
  });
  const elections = bluesky.addPost("a post about elections");
  const deleted = bluesky.addPost("a post that was deleted");
  const football = bluesky.addPost("a post about football");
  const cooking = bluesky.addPost("a post about cooking");
  const music = bluesky.addPost("a post about music");
  const electionsLike = bluesky.addLike({
    subject: elections.uri,
    createdAt: createdBefore(2 * YEAR),
  });
  const deletedLike = bluesky.addLike({
    subject: deleted.uri,
    createdAt: createdBefore(400 * DAY),
  });
  const footballLike = bluesky.addLike({
    subject: football.uri,
    createdAt: createdBefore(YEAR + HOUR),
  });
  bluesky.addLike({ subject: cooking.uri, createdAt: createdBefore(YEAR - HOUR) });
  bluesky.addLike({ subject: music.uri, createdAt: createdBefore(DAY) });
  bluesky.deletePost(deleted);
  expect(bluesky.posts().map((post) => post.uri)).not.toContain(deleted.uri);
  expect(bluesky.likes().map((like) => like.subject)).toContain(deleted.uri);
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
    { level: "debug", message: `deleting like ${electionsLike.uri}` },
    { level: "debug", message: `deleting like ${deletedLike.uri}` },
    { level: "debug", message: `deleting like ${footballLike.uri}` },
    { level: "info", message: "Deleted 3 of 3 likes older than one year" },
    { level: "info", message: "No reposts are older than one year" },
  ]);
  expect(bluesky.likes().map((like) => like.subject)).toStrictEqual([cooking.uri, music.uri]);
});
