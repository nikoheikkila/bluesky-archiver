// Feature: feature/delete-old-reposts.feature
// Scenario: Daily run deletes only reposts older than one year
import { expect, test } from "vitest";
import { createdAgo, DAY, HOUR, RUN_START, YEAR } from "./constants";
import { createEnvBluesky, deletesOf, runDailyWorker, serveBluesky } from "./network";

test("Daily run deletes only reposts older than one year", async () => {
  const bluesky = createEnvBluesky();
  const elections = bluesky.addPost("a post about elections");
  const deleted = bluesky.addPost("a post that was deleted");
  const football = bluesky.addPost("a post about football");
  const cooking = bluesky.addPost("a post about cooking");
  const music = bluesky.addPost("a post about music");
  const electionsRepost = bluesky.addRepost({
    subject: elections.uri,
    createdAt: createdAgo(2 * YEAR),
  });
  const deletedRepost = bluesky.addRepost({
    subject: deleted.uri,
    createdAt: createdAgo(400 * DAY),
  });
  const footballRepost = bluesky.addRepost({
    subject: football.uri,
    createdAt: createdAgo(YEAR + HOUR),
  });
  bluesky.addRepost({ subject: cooking.uri, createdAt: createdAgo(YEAR - HOUR) });
  bluesky.addRepost({ subject: music.uri, createdAt: createdAgo(DAY) });
  bluesky.deletePost(deleted);
  expect(bluesky.reposts().map((repost) => repost.subject)).toContain(deleted.uri);
  serveBluesky(bluesky);

  await runDailyWorker(RUN_START);

  expect(bluesky.reposts().map((repost) => repost.subject)).toStrictEqual([cooking.uri, music.uri]);
  expect(bluesky.receivedWrites()).toStrictEqual([
    deletesOf("app.bsky.feed.repost", [electionsRepost, deletedRepost, footballRepost]),
  ]);
});
