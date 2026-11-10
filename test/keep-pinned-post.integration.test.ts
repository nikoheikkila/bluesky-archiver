// Feature: feature/keep-pinned-post.feature
// Scenario: Daily run keeps the pinned post when every other post is deleted
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { DAY, HOUR, YEAR } from "./constants";
import { createFakeBluesky } from "./fake-bluesky";
import { deletesOf, runDailyWorker, serveBluesky } from "./network";

test("Daily run keeps the pinned post when every other post is deleted", async () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const createdBefore = (ms: number) => new Date(runStart - ms).toISOString();

  const bluesky = createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: env.BLUESKY_APP_PASSWORD,
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
  serveBluesky(bluesky);

  await runDailyWorker(runStart);

  expect(bluesky.accountPosts().map((post) => post.uri)).toStrictEqual([welcome.uri]);
  expect(bluesky.receivedWrites()).toStrictEqual([
    deletesOf("app.bsky.feed.post", [elections, reply]),
  ]);
});
