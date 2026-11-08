// Feature: feature/dry-run-old-likes.feature
// Scenario: Dry run lists only likes older than one year
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";
import worker from "../src/index";
import { createFakeBluesky } from "./fake-bluesky";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

afterEach(() => {
  vi.restoreAllMocks();
});

test("Dry run lists only likes older than one year", async () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const createdBefore = (ms: number) => new Date(runStart - ms).toISOString();

  const bluesky = createFakeBluesky({ did: env.BLUESKY_DID, baseUrl: env.BLUESKY_SERVER_URL });
  const elections = bluesky.addPost("a post about elections");
  const deleted = bluesky.addPost("a post that was deleted");
  const football = bluesky.addPost("a post about football");
  const cooking = bluesky.addPost("a post about cooking");
  const music = bluesky.addPost("a post about music");
  const electionsCreatedAt = createdBefore(2 * YEAR);
  const deletedCreatedAt = createdBefore(400 * DAY);
  const footballCreatedAt = createdBefore(YEAR + HOUR);

  bluesky.addLike({ subject: elections.uri, createdAt: electionsCreatedAt });
  bluesky.addLike({ subject: deleted.uri, createdAt: deletedCreatedAt });
  bluesky.addLike({ subject: football.uri, createdAt: footballCreatedAt });
  bluesky.addLike({ subject: cooking.uri, createdAt: createdBefore(YEAR - HOUR) });
  bluesky.addLike({ subject: music.uri, createdAt: createdBefore(DAY) });
  bluesky.deletePost(deleted);
  expect(bluesky.posts().map((post) => post.uri)).not.toContain(deleted.uri);
  expect(bluesky.likes().map((like) => like.subject)).toContain(deleted.uri);
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const controller = createScheduledController({ scheduledTime: runStart });
  const ctx = createExecutionContext();
  await worker.scheduled(controller, env, ctx);
  await waitOnExecutionContext(ctx);

  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    `${electionsCreatedAt} ${elections.uri}`,
    `${deletedCreatedAt} ${deleted.uri}`,
    `${footballCreatedAt} ${football.uri}`,
    "3 likes are older than one year and would be deleted.",
  ]);
  expect(bluesky.likes()).toHaveLength(5);
});
