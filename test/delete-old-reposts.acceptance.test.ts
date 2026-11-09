// Feature: feature/delete-old-reposts.feature
// Scenario: Daily run deletes only reposts older than one year
import { createScheduledController, env } from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";
import worker from "../src/index";
import { createFakeBluesky } from "./fake-bluesky";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
const APP_PASSWORD = "test-app-password";

afterEach(() => {
  vi.restoreAllMocks();
});

// Expected to fail until the daily run deletes reposts; test.fails turns red once it passes.
test.fails("Daily run deletes only reposts older than one year", async () => {
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
  const electionsCreatedAt = createdBefore(2 * YEAR);
  const deletedCreatedAt = createdBefore(400 * DAY);
  const footballCreatedAt = createdBefore(YEAR + HOUR);

  bluesky.addRepost({ subject: elections.uri, createdAt: electionsCreatedAt });
  bluesky.addRepost({ subject: deleted.uri, createdAt: deletedCreatedAt });
  bluesky.addRepost({ subject: football.uri, createdAt: footballCreatedAt });
  bluesky.addRepost({ subject: cooking.uri, createdAt: createdBefore(YEAR - HOUR) });
  bluesky.addRepost({ subject: music.uri, createdAt: createdBefore(DAY) });
  bluesky.deletePost(deleted);
  expect(bluesky.posts().map((post) => post.uri)).not.toContain(deleted.uri);
  expect(bluesky.reposts().map((repost) => repost.subject)).toContain(deleted.uri);
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const workerEnv = { ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD };

  const controller = createScheduledController({ scheduledTime: runStart });
  await worker.scheduled(controller, workerEnv);

  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    "No likes are older than one year",
    `${electionsCreatedAt} ${elections.uri}`,
    `${deletedCreatedAt} ${deleted.uri}`,
    `${footballCreatedAt} ${football.uri}`,
    "Deleted 3 of 3 reposts older than one year",
  ]);
  expect(bluesky.reposts().map((repost) => repost.subject)).toStrictEqual([cooking.uri, music.uri]);
});
