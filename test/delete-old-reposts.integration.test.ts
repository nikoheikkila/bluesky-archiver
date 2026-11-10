// Feature: feature/delete-old-reposts.feature
// Scenario: Daily run deletes only reposts older than one year
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { DAY, HOUR, YEAR } from "./constants";
import { createFakeBluesky } from "./fake-bluesky";
import { deletesOf, runDailyWorker, serveBluesky } from "./network";

test("Daily run deletes only reposts older than one year", async () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const createdBefore = (ms: number) => new Date(runStart - ms).toISOString();

  const bluesky = createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: env.BLUESKY_APP_PASSWORD,
  });
  const elections = bluesky.addPost("a post about elections");
  const deleted = bluesky.addPost("a post that was deleted");
  const football = bluesky.addPost("a post about football");
  const cooking = bluesky.addPost("a post about cooking");
  const music = bluesky.addPost("a post about music");
  const electionsRepost = bluesky.addRepost({
    subject: elections.uri,
    createdAt: createdBefore(2 * YEAR),
  });
  const deletedRepost = bluesky.addRepost({
    subject: deleted.uri,
    createdAt: createdBefore(400 * DAY),
  });
  const footballRepost = bluesky.addRepost({
    subject: football.uri,
    createdAt: createdBefore(YEAR + HOUR),
  });
  bluesky.addRepost({ subject: cooking.uri, createdAt: createdBefore(YEAR - HOUR) });
  bluesky.addRepost({ subject: music.uri, createdAt: createdBefore(DAY) });
  bluesky.deletePost(deleted);
  expect(bluesky.posts().map((post) => post.uri)).not.toContain(deleted.uri);
  expect(bluesky.reposts().map((repost) => repost.subject)).toContain(deleted.uri);
  serveBluesky(bluesky);

  await runDailyWorker(runStart);

  expect(bluesky.reposts().map((repost) => repost.subject)).toStrictEqual([cooking.uri, music.uri]);
  expect(bluesky.receivedWrites()).toStrictEqual([
    deletesOf("app.bsky.feed.repost", [electionsRepost, deletedRepost, footballRepost]),
  ]);
});
