// Feature: feature/delete-old-posts.feature
// Scenario: Daily run deletes only posts older than one year, with their reply and quote settings
import { createScheduledController, env } from "cloudflare:test";
import { expect, test } from "vitest";
import { createWorker, type LogEntry } from "../src/worker";
import { DAY, HOUR, YEAR } from "./constants";
import { createFakeBluesky, type NewAccountPost } from "./fake-bluesky";

const APP_PASSWORD = "test-app-password";

// Expected to fail until cycle 5 of specs/delete-old-posts.md; remove this marker when the acceptance test passes.
test.fails("Daily run deletes only posts older than one year, with their reply and quote settings", async () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const createdBefore = (ms: number) => new Date(runStart - ms).toISOString();

  const bluesky = createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: APP_PASSWORD,
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
    ...added
      .slice(0, 3)
      .map((post) => ({ level: "debug" as const, message: `deleting post ${post.uri}` })),
    { level: "info", message: "Deleted 3 of 3 posts older than one year" },
    ...replySettings.slice(0, 3).map((settings) => ({
      level: "debug" as const,
      message: `deleting reply settings ${settings.uri}`,
    })),
    { level: "info", message: "Deleted 3 of 3 reply settings older than one year" },
    ...quoteSettings.slice(0, 3).map((settings) => ({
      level: "debug" as const,
      message: `deleting quote settings ${settings.uri}`,
    })),
    { level: "info", message: "Deleted 3 of 3 quote settings older than one year" },
  ]);
  expect(bluesky.accountPosts().map((post) => post.uri)).toStrictEqual([cooking?.uri, music?.uri]);
  expect(bluesky.replySettings().map((settings) => settings.post)).toStrictEqual([
    cooking?.uri,
    music?.uri,
  ]);
  expect(bluesky.quoteSettings().map((settings) => settings.post)).toStrictEqual([
    cooking?.uri,
    music?.uri,
  ]);
});
