// Feature: feature/keep-pinned-post.feature
// Scenario: Daily run keeps the pinned post when every other post is deleted
import { expect, test } from "vitest";
import { createdAgo, DAY, HOUR, RUN_START, YEAR } from "./constants";
import { createEnvBluesky, deletesOf, runDailyWorker, serveBluesky } from "./network";

test("Daily run keeps the pinned post when every other post is deleted", async () => {
  const bluesky = createEnvBluesky();
  const music = bluesky.addPost("a post about music");
  const elections = bluesky.addAccountPost({
    kind: "plain",
    text: "a post about elections",
    createdAt: createdAgo(2 * YEAR),
  });
  const welcome = bluesky.addAccountPost({
    kind: "plain",
    text: "a welcome post",
    createdAt: createdAgo(400 * DAY),
  });
  const reply = bluesky.addAccountPost({
    kind: "reply",
    text: "a reply about music",
    createdAt: createdAgo(YEAR + HOUR),
    parent: music.uri,
  });
  bluesky.pinPost(welcome);
  serveBluesky(bluesky);

  await runDailyWorker(RUN_START);

  expect(bluesky.accountPosts().map((post) => post.uri)).toStrictEqual([welcome.uri]);
  expect(bluesky.receivedWrites()).toStrictEqual([
    deletesOf("app.bsky.feed.post", [elections, reply]),
  ]);
});
