// Feature: feature/delete-old-likes.feature
// Scenario: Daily run deletes only likes older than one year
import { expect, test } from "vitest";
import { createdAgo, DAY, HOUR, RUN_START, YEAR } from "./constants";
import { createEnvBluesky, deletesOf, runDailyWorker, serveBluesky } from "./network";

test("Daily run deletes only likes older than one year", async () => {
  const bluesky = createEnvBluesky();
  const elections = bluesky.addPost("a post about elections");
  const deleted = bluesky.addPost("a post that was deleted");
  const football = bluesky.addPost("a post about football");
  const cooking = bluesky.addPost("a post about cooking");
  const music = bluesky.addPost("a post about music");
  const old = bluesky.addLikes([
    { subject: elections.uri, createdAt: createdAgo(2 * YEAR) },
    { subject: deleted.uri, createdAt: createdAgo(400 * DAY) },
    { subject: football.uri, createdAt: createdAgo(YEAR + HOUR) },
  ]);
  bluesky.addLike({ subject: cooking.uri, createdAt: createdAgo(YEAR - HOUR) });
  bluesky.addLike({ subject: music.uri, createdAt: createdAgo(DAY) });
  bluesky.deletePost(deleted);
  expect(bluesky.likes().map((like) => like.subject)).toContain(deleted.uri);
  serveBluesky(bluesky);

  await runDailyWorker(RUN_START);

  expect(bluesky.likes().map((like) => like.subject)).toStrictEqual([cooking.uri, music.uri]);
  expect(bluesky.receivedWrites()).toStrictEqual([deletesOf("app.bsky.feed.like", old)]);
});
