// Feature: feature/delete-old-posts.feature
// Scenario: Daily run deletes only posts older than one year, with their reply and quote settings
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { DAY, HOUR, YEAR } from "./constants";
import { createFakeBluesky, type NewAccountPost } from "./fake-bluesky";
import { deletesOf, runDailyWorker, serveBluesky } from "./network";

test("Daily run deletes only posts older than one year, with their reply and quote settings", async () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const createdBefore = (ms: number) => new Date(runStart - ms).toISOString();

  const bluesky = createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: env.BLUESKY_APP_PASSWORD,
  });
  const deleted = bluesky.addPost("a post that was deleted");
  const football = bluesky.addPost("a post about football");
  bluesky.deletePost(deleted);
  const posts: NewAccountPost[] = [
    { kind: "plain", text: "a post about elections", createdAt: createdBefore(2 * YEAR) },
    {
      kind: "reply",
      text: "a reply to a deleted post",
      createdAt: createdBefore(400 * DAY),
      parent: deleted.uri,
    },
    {
      kind: "quote",
      text: "a quote of a post about football",
      createdAt: createdBefore(YEAR + HOUR),
      quoted: football.uri,
    },
    { kind: "plain", text: "a post about cooking", createdAt: createdBefore(YEAR - HOUR) },
    {
      kind: "reply",
      text: "a reply about music",
      createdAt: createdBefore(DAY),
      parent: football.uri,
    },
  ];
  const added = posts.map((post) => bluesky.addAccountPost(post));
  const replySettings = added.map((post) =>
    bluesky.addReplySettings({ post, createdAt: post.createdAt }),
  );
  const quoteSettings = added.map((post) =>
    bluesky.addQuoteSettings({ post, createdAt: post.createdAt }),
  );
  const [cooking, music] = added.slice(3);
  serveBluesky(bluesky);

  await runDailyWorker(runStart);

  expect(bluesky.accountPosts().map((post) => post.uri)).toStrictEqual([cooking?.uri, music?.uri]);
  expect(bluesky.replySettings().map((settings) => settings.post)).toStrictEqual([
    cooking?.uri,
    music?.uri,
  ]);
  expect(bluesky.quoteSettings().map((settings) => settings.post)).toStrictEqual([
    cooking?.uri,
    music?.uri,
  ]);
  expect(bluesky.receivedWrites()).toStrictEqual([
    deletesOf("app.bsky.feed.post", added.slice(0, 3)),
    deletesOf("app.bsky.feed.threadgate", replySettings.slice(0, 3)),
    deletesOf("app.bsky.feed.postgate", quoteSettings.slice(0, 3)),
  ]);
});
