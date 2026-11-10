// Feature: feature/delete-old-likes.feature
// Cycle 5: wire the daily run.
import { createScheduledController, env } from "cloudflare:test";
import { expect, test } from "vitest";
import { createWorker, type LogEntry } from "../src/worker";
import { DAY, HOUR } from "./constants";
import {
  createFakeBluesky,
  type FakeAccountPost,
  type FakeBluesky,
  type NewAccountPost,
  type NewRepost,
} from "./fake-bluesky";

const RUN_START = Date.parse("2026-11-08T03:00:00Z");
const APP_PASSWORD = "test-app-password";
const WRONG_PASSWORD = "wrong-app-password";
const NO_OLD_LIKES = "No likes are older than one year";
const NO_OLD_REPOSTS = "No reposts are older than one year";
const NO_OLD_POSTS = "No posts are older than one year";
const NO_OLD_REPLY_SETTINGS = "No reply settings are older than one year";
const NO_OLD_QUOTE_SETTINGS = "No quote settings are older than one year";

const createdAgo = (ms: number) => new Date(RUN_START - ms).toISOString();
const info = (message: string): LogEntry => ({ level: "info", message });
const noOldPostsOrSettings = [
  info(NO_OLD_POSTS),
  info(NO_OLD_REPLY_SETTINGS),
  info(NO_OLD_QUOTE_SETTINGS),
];
const deleting = (
  noun: "like" | "repost" | "post" | "reply settings" | "quote settings",
  record: { uri: string },
): LogEntry => ({
  level: "debug",
  message: `deleting ${noun} ${record.uri}`,
});

function newBluesky() {
  return createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: APP_PASSWORD,
  });
}

/**
 * One scheduled run against the fake, with the app password it is given; `entries` collects its
 * log with levels, and `lines` the same log's messages only.
 */
function newRun(bluesky: FakeBluesky, password: string | undefined) {
  const entries: LogEntry[] = [];
  const lines: string[] = [];
  const worker = createWorker({
    fetch: bluesky.fetch,
    log: (entry) => {
      entries.push(entry);
      lines.push(entry.message);
    },
  });
  const controller = createScheduledController({ scheduledTime: RUN_START, cron: "0 3 * * *" });
  const run = () => worker.scheduled(controller, { ...env, BLUESKY_APP_PASSWORD: password });
  return { entries, lines, run };
}

const requestsTo = (bluesky: FakeBluesky, method: string) =>
  bluesky.requests().filter((request) => new URL(request.url).pathname === `/xrpc/${method}`);

// One entry per run of consecutive requests: listRecords is tagged with its collection, so paging collapses.
function requestPhases(bluesky: FakeBluesky): string[] {
  const phases = bluesky.requests().map((request) => {
    const url = new URL(request.url);
    const method = url.pathname.replace("/xrpc/com.atproto.", "");
    return method === "repo.listRecords"
      ? `listRecords ${url.searchParams.get("collection")}`
      : method;
  });
  return phases.filter((phase, index) => phase !== phases[index - 1]);
}

const listedCollections = (bluesky: FakeBluesky) =>
  requestsTo(bluesky, "com.atproto.repo.listRecords").map((request) =>
    new URL(request.url).searchParams.get("collection"),
  );

test("fails loudly and logs no total when listing a page fails", async () => {
  const bluesky = createFakeBluesky({ did: env.BLUESKY_DID, baseUrl: env.BLUESKY_SERVER_URL });
  const post = bluesky.addPost("a post");
  bluesky.addLikes(Array(150).fill({ subject: post.uri, createdAt: createdAgo(400 * DAY) }));
  bluesky.failPage({ cursor: "100", status: 500 });
  const { lines, run } = newRun(bluesky, env.BLUESKY_APP_PASSWORD);

  await expect(run()).rejects.toThrow();

  expect(lines.filter((line) => /older than one year|No likes are/.test(line))).toStrictEqual([]);
});

test("reports no old likes and neither logs in nor deletes when every like is younger than one year", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLikes([
    { subject: post.uri, createdAt: createdAgo(1 * DAY) },
    { subject: post.uri, createdAt: createdAgo(364 * DAY) },
  ]);
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    info(NO_OLD_LIKES),
    info(NO_OLD_REPOSTS),
    ...noOldPostsOrSettings,
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(0);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect(bluesky.likes()).toHaveLength(2);
});

test("reports nothing old after one listing request per collection when the account has none", async () => {
  const bluesky = newBluesky();
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    info(NO_OLD_LIKES),
    info(NO_OLD_REPOSTS),
    ...noOldPostsOrSettings,
  ]);
  expect(listedCollections(bluesky)).toStrictEqual([
    "app.bsky.feed.like",
    "app.bsky.feed.repost",
    "app.bsky.feed.post",
    "app.bsky.feed.threadgate",
    "app.bsky.feed.postgate",
  ]);
  expect(bluesky.requests()).toHaveLength(5);
});

test("stays within 41 requests when deleting 2 old likes out of 2,056 and 326 old posts out of 662", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const old = { subject: post.uri, createdAt: createdAgo(400 * DAY) };
  const young = { subject: post.uri, createdAt: createdAgo(10 * DAY) };
  bluesky.addLikes([old, old, ...Array(2054).fill(young)]);
  bluesky.addReposts(Array(235).fill(young));
  const accountPosts = [
    ...Array(326).fill(createdAgo(400 * DAY)),
    ...Array(336).fill(createdAgo(10 * DAY)),
  ].map((createdAt: string) =>
    bluesky.addAccountPost({ kind: "plain", text: "an account post", createdAt }),
  );
  bluesky.addReplySettings({
    post: accountPosts[661] as FakeAccountPost,
    createdAt: createdAgo(10 * DAY),
  });
  const { run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(requestsTo(bluesky, "com.atproto.repo.listRecords")).toHaveLength(37);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(3);
  expect(bluesky.requests()).toHaveLength(41);
});

test("keeps the deleted likes logged after a failed batch and deletes the rest on the next run", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const createdAts = Array.from({ length: 450 }, (_, i) => createdAgo(400 * DAY + i * HOUR));
  const likes = bluesky.addLikes(createdAts.map((createdAt) => ({ subject: post.uri, createdAt })));
  bluesky.failApplyWrites({ call: 2, status: 500 });
  const firstRun = newRun(bluesky, APP_PASSWORD);

  const error = await firstRun.run().catch((e: unknown) => e);

  expect(error).toBeInstanceOf(Error);
  expect(firstRun.entries).toStrictEqual(
    likes
      .slice(250)
      .reverse()
      .map((like) => deleting("like", like)),
  );
  expect(bluesky.likes().map((like) => like.createdAt)).toStrictEqual(createdAts.slice(0, 250));
  expect([...firstRun.lines, String(error)].join("\n")).not.toContain(APP_PASSWORD);

  const secondRun = newRun(bluesky, APP_PASSWORD);

  await expect(secondRun.run()).resolves.toBeUndefined();

  expect(secondRun.entries.slice(-5)).toStrictEqual([
    info("Deleted 250 of 250 likes older than one year"),
    info(NO_OLD_REPOSTS),
    ...noOldPostsOrSettings,
  ]);
  expect(bluesky.likes()).toStrictEqual([]);
});

test("deletes only the datable old like and reports the undatable likes as skipped", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const createdAt = createdAgo(400 * DAY);
  const [noDate, notADate, old] = bluesky.addLikes([
    { subject: post.uri, createdAt: "" },
    { subject: post.uri, createdAt: "not-a-date" },
    { subject: post.uri, createdAt },
  ]);
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    deleting("like", old),
    info("Skipped 2 likes without a valid creation time"),
    info("Deleted 1 of 1 like older than one year"),
    info(NO_OLD_REPOSTS),
    ...noOldPostsOrSettings,
  ]);
  expect(bluesky.likes()).toStrictEqual([noDate, notADate]);
});

test.each([
  { label: "undefined", appPassword: undefined },
  { label: "an empty string", appPassword: "" },
])("fails before any request when BLUESKY_APP_PASSWORD is $label", async ({ appPassword }) => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLike({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  const { lines, run } = newRun(bluesky, appPassword);

  await expect(run()).rejects.toThrow("BLUESKY_APP_PASSWORD");

  expect(bluesky.requests()).toStrictEqual([]);
  expect(lines).toStrictEqual([]);
});

test("fails without deleting or reporting a total when the login is rejected", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLikes([
    { subject: post.uri, createdAt: createdAgo(400 * DAY) },
    { subject: post.uri, createdAt: createdAgo(2 * DAY) },
  ]);
  const { lines, run } = newRun(bluesky, WRONG_PASSWORD);

  const error = await run().catch((e: unknown) => e);

  expect(error).toBeInstanceOf(Error);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect(lines.filter((line) => /older than one year|No likes are/.test(line))).toStrictEqual([]);
  expect([...lines, String(error)].join("\n")).not.toContain(WRONG_PASSWORD);
  expect(bluesky.likes()).toHaveLength(2);
});

test("deletes old likes before listing reposts, then old reposts, with a single login", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const [newerLike, olderLike] = bluesky.addLikes([
    { subject: post.uri, createdAt: createdAgo(400 * DAY) },
    { subject: post.uri, createdAt: createdAgo(401 * DAY) },
  ]);
  const [newerRepost, olderRepost] = bluesky.addReposts([
    { subject: post.uri, createdAt: createdAgo(400 * DAY + HOUR) },
    { subject: post.uri, createdAt: createdAgo(401 * DAY + HOUR) },
  ]);
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(requestPhases(bluesky)).toStrictEqual([
    "listRecords app.bsky.feed.like",
    "server.createSession",
    "repo.applyWrites",
    "listRecords app.bsky.feed.repost",
    "repo.applyWrites",
    "listRecords app.bsky.feed.post",
    "listRecords app.bsky.feed.threadgate",
    "listRecords app.bsky.feed.postgate",
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(entries).toStrictEqual([
    deleting("like", olderLike),
    deleting("like", newerLike),
    info("Deleted 2 of 2 likes older than one year"),
    deleting("repost", olderRepost),
    deleting("repost", newerRepost),
    info("Deleted 2 of 2 reposts older than one year"),
    ...noOldPostsOrSettings,
  ]);
  expect(bluesky.likes()).toStrictEqual([]);
  expect(bluesky.reposts()).toStrictEqual([]);
});

test("reports no old reposts and neither logs in nor deletes when every repost is younger than one year", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addReposts([
    { subject: post.uri, createdAt: createdAgo(1 * DAY) },
    { subject: post.uri, createdAt: createdAgo(364 * DAY) },
  ]);
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    info(NO_OLD_LIKES),
    info(NO_OLD_REPOSTS),
    ...noOldPostsOrSettings,
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(0);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect(bluesky.reposts()).toHaveLength(2);
});

test("logs in after listing reposts when only a repost is older than one year", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const like = bluesky.addLike({ subject: post.uri, createdAt: createdAgo(1 * DAY) });
  const repost = bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(requestPhases(bluesky)).toStrictEqual([
    "listRecords app.bsky.feed.like",
    "listRecords app.bsky.feed.repost",
    "server.createSession",
    "repo.applyWrites",
    "listRecords app.bsky.feed.post",
    "listRecords app.bsky.feed.threadgate",
    "listRecords app.bsky.feed.postgate",
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(entries).toStrictEqual([
    info(NO_OLD_LIKES),
    deleting("repost", repost),
    info("Deleted 1 of 1 repost older than one year"),
    ...noOldPostsOrSettings,
  ]);
  expect(bluesky.likes()).toStrictEqual([like]);
  expect(bluesky.reposts()).toStrictEqual([]);
});

test("keeps the deleted likes and reposts logged after a failed repost batch and deletes the rest on the next run", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const like = bluesky.addLike({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  const repostCreatedAts = Array.from({ length: 450 }, (_, i) => createdAgo(400 * DAY + i * HOUR));
  const reposts = bluesky.addReposts(
    repostCreatedAts.map((createdAt) => ({ subject: post.uri, createdAt })),
  );
  bluesky.failApplyWrites({ call: 3, status: 500 });
  const firstRun = newRun(bluesky, APP_PASSWORD);

  await expect(firstRun.run()).rejects.toThrow();

  expect(firstRun.entries).toStrictEqual([
    deleting("like", like),
    info("Deleted 1 of 1 like older than one year"),
    ...reposts
      .slice(250)
      .reverse()
      .map((repost) => deleting("repost", repost)),
  ]);
  expect(bluesky.likes()).toStrictEqual([]);
  expect(bluesky.reposts().map((repost) => repost.createdAt)).toStrictEqual(
    repostCreatedAts.slice(0, 250),
  );

  const secondRun = newRun(bluesky, APP_PASSWORD);

  await expect(secondRun.run()).resolves.toBeUndefined();

  expect(secondRun.entries).toStrictEqual([
    info(NO_OLD_LIKES),
    ...reposts
      .slice(0, 250)
      .reverse()
      .map((repost) => deleting("repost", repost)),
    info("Deleted 250 of 250 reposts older than one year"),
    ...noOldPostsOrSettings,
  ]);
  expect(bluesky.reposts()).toStrictEqual([]);
});

test("fails loudly, lists no reposts and logs no total when listing a likes page fails", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLikes(Array(150).fill({ subject: post.uri, createdAt: createdAgo(400 * DAY) }));
  bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  bluesky.failPage({ cursor: "100", status: 500 });
  const { lines, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).rejects.toThrow();

  expect(listedCollections(bluesky)).toStrictEqual(["app.bsky.feed.like", "app.bsky.feed.like"]);
  expect(
    lines.filter((line) => /older than one year|No (likes|reposts) are/.test(line)),
  ).toStrictEqual([]);
  expect(bluesky.reposts()).toHaveLength(1);
});

test("lists and deletes only the five collections, one collection per write batch, across a mixed run", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const old = { subject: post.uri, createdAt: createdAgo(400 * DAY) };
  bluesky.addLikes(Array(3).fill(old));
  bluesky.addReposts(Array(3).fill(old));
  const accountPost = bluesky.addAccountPost({
    kind: "quote",
    text: "a quote of a post",
    createdAt: createdAgo(400 * DAY),
    quoted: post.uri,
  });
  bluesky.addReplySettings({ post: accountPost, createdAt: createdAgo(400 * DAY) });
  bluesky.addQuoteSettings({ post: accountPost, createdAt: createdAgo(400 * DAY) });
  const { run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(listedCollections(bluesky)).toStrictEqual(
    [
      "app.bsky.feed.like",
      "app.bsky.feed.repost",
      "app.bsky.feed.post",
      "app.bsky.feed.threadgate",
      "app.bsky.feed.postgate",
    ].flatMap((collection) => [collection, collection]),
  );
  const batches = bluesky.receivedWrites();
  expect(
    batches.map((writes) => [...new Set(writes.map((write) => write.collection))]),
  ).toStrictEqual([
    ["app.bsky.feed.like"],
    ["app.bsky.feed.repost"],
    ["app.bsky.feed.post"],
    ["app.bsky.feed.threadgate"],
    ["app.bsky.feed.postgate"],
  ]);
  expect(
    batches.flat().filter((write) => write.$type !== "com.atproto.repo.applyWrites#delete"),
  ).toStrictEqual([]);
  expect(bluesky.accountPosts()).toStrictEqual([]);
  expect(bluesky.replySettings()).toStrictEqual([]);
  expect(bluesky.quoteSettings()).toStrictEqual([]);
});

test("deletes the old repost and the old quote post, each in its own write batch", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const quote = bluesky.addAccountPost({
    kind: "quote",
    text: "a quote of a post",
    createdAt: createdAgo(400 * DAY),
    quoted: post.uri,
  });
  const repost = bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    info(NO_OLD_LIKES),
    deleting("repost", repost),
    info("Deleted 1 of 1 repost older than one year"),
    deleting("post", quote),
    info("Deleted 1 of 1 post older than one year"),
    info(NO_OLD_REPLY_SETTINGS),
    info(NO_OLD_QUOTE_SETTINGS),
  ]);
  expect(bluesky.reposts()).toStrictEqual([]);
  expect(bluesky.accountPosts()).toStrictEqual([]);
  expect(
    bluesky.receivedWrites().map((writes) => writes.map((write) => write.collection)),
  ).toStrictEqual([["app.bsky.feed.repost"], ["app.bsky.feed.post"]]);
});

test("runs every kind in order after one login when one record of each is older than one year", async () => {
  const bluesky = newBluesky();
  const subject = bluesky.addPost("a post");
  const createdAt = createdAgo(400 * DAY);
  bluesky.addLike({ subject: subject.uri, createdAt });
  bluesky.addRepost({ subject: subject.uri, createdAt });
  const post = bluesky.addAccountPost({ kind: "plain", text: "an account post", createdAt });
  bluesky.addReplySettings({ post, createdAt });
  bluesky.addQuoteSettings({ post, createdAt });
  const { run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(requestPhases(bluesky)).toStrictEqual([
    "listRecords app.bsky.feed.like",
    "server.createSession",
    "repo.applyWrites",
    "listRecords app.bsky.feed.repost",
    "repo.applyWrites",
    "listRecords app.bsky.feed.post",
    "repo.applyWrites",
    "listRecords app.bsky.feed.threadgate",
    "repo.applyWrites",
    "listRecords app.bsky.feed.postgate",
    "repo.applyWrites",
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(bluesky.requests()).toHaveLength(16);
});

test("fails after the likes total, with no reposts total or repost write, when listing a repost page fails", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const like = bluesky.addLike({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  bluesky.addReposts(Array(150).fill({ subject: post.uri, createdAt: createdAgo(400 * DAY) }));
  bluesky.failPage({ cursor: "100", status: 500 });
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).rejects.toThrow();

  expect(entries).toStrictEqual([
    deleting("like", like),
    info("Deleted 1 of 1 like older than one year"),
  ]);
  expect(listedCollections(bluesky)).toStrictEqual([
    "app.bsky.feed.like",
    "app.bsky.feed.like",
    "app.bsky.feed.repost",
    "app.bsky.feed.repost",
  ]);
  expect(
    bluesky.receivedWrites().map((writes) => writes.map((write) => write.collection)),
  ).toStrictEqual([["app.bsky.feed.like"]]);
  expect(bluesky.reposts()).toHaveLength(150);
});

test("fails with no reposts total and keeps the repost when the login is rejected in the repost phase", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLike({ subject: post.uri, createdAt: createdAgo(1 * DAY) });
  bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  const { entries, lines, run } = newRun(bluesky, WRONG_PASSWORD);

  const error = await run().catch((e: unknown) => e);

  expect(error).toBeInstanceOf(Error);
  expect(entries).toStrictEqual([info(NO_OLD_LIKES)]);
  expect(requestPhases(bluesky)).toStrictEqual([
    "listRecords app.bsky.feed.like",
    "listRecords app.bsky.feed.repost",
    "server.createSession",
  ]);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect([...lines, String(error)].join("\n")).not.toContain(WRONG_PASSWORD);
  expect(bluesky.reposts()).toHaveLength(1);
});

test("deletes only the datable old repost and reports the undatable reposts as skipped", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const createdAt = createdAgo(400 * DAY);
  const [noDate, notADate, old] = bluesky.addReposts([
    { subject: post.uri } as unknown as NewRepost,
    { subject: post.uri, createdAt: "not-a-date" },
    { subject: post.uri, createdAt },
  ]);
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    info(NO_OLD_LIKES),
    deleting("repost", old),
    info("Skipped 2 reposts without a valid creation time"),
    info("Deleted 1 of 1 repost older than one year"),
    ...noOldPostsOrSettings,
  ]);
  expect(bluesky.reposts()).toStrictEqual([noDate, notADate]);
});

// A post of the account that is no longer served, so only its settings record is left.
const goneAccountPost = (name: string, createdAt: string): FakeAccountPost => ({
  kind: "plain",
  text: "a post deleted by hand",
  createdAt,
  uri: `at://${env.BLUESKY_DID}/app.bsky.feed.post/${name}`,
});

test("keeps the deleted likes and posts logged after a failed post batch and deletes the rest on the next run", async () => {
  const bluesky = newBluesky();
  const subject = bluesky.addPost("a post");
  const like = bluesky.addLike({ subject: subject.uri, createdAt: createdAgo(400 * DAY) });
  const postCreatedAts = Array.from({ length: 450 }, (_, i) => createdAgo(400 * DAY + i * HOUR));
  const posts = postCreatedAts.map((createdAt) =>
    bluesky.addAccountPost({ kind: "plain", text: "an account post", createdAt }),
  );
  bluesky.failApplyWrites({ call: 3, status: 500 });
  const firstRun = newRun(bluesky, APP_PASSWORD);

  await expect(firstRun.run()).rejects.toThrow();

  expect(firstRun.entries).toStrictEqual([
    deleting("like", like),
    info("Deleted 1 of 1 like older than one year"),
    info(NO_OLD_REPOSTS),
    ...posts
      .slice(250)
      .reverse()
      .map((post) => deleting("post", post)),
  ]);
  expect(listedCollections(bluesky)).not.toContain("app.bsky.feed.threadgate");
  expect(listedCollections(bluesky)).not.toContain("app.bsky.feed.postgate");
  expect(bluesky.accountPosts().map((post) => post.createdAt)).toStrictEqual(
    postCreatedAts.slice(0, 250),
  );

  const secondRun = newRun(bluesky, APP_PASSWORD);

  await expect(secondRun.run()).resolves.toBeUndefined();

  expect(secondRun.entries).toStrictEqual([
    info(NO_OLD_LIKES),
    info(NO_OLD_REPOSTS),
    ...posts
      .slice(0, 250)
      .reverse()
      .map((post) => deleting("post", post)),
    info("Deleted 250 of 250 posts older than one year"),
    info(NO_OLD_REPLY_SETTINGS),
    info(NO_OLD_QUOTE_SETTINGS),
  ]);
  expect(bluesky.accountPosts()).toStrictEqual([]);
});

test("fails after the posts report, with no reply settings total and no postgate request, when listing a reply settings page fails", async () => {
  const bluesky = newBluesky();
  const settings = Array.from({ length: 101 }, (_, i) =>
    bluesky.addReplySettings({
      post: goneAccountPost(`gone${i}`, createdAgo(400 * DAY)),
      createdAt: createdAgo(400 * DAY),
    }),
  );
  bluesky.failPage({ cursor: "100", status: 500 });
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).rejects.toThrow();

  expect(entries).toStrictEqual([info(NO_OLD_LIKES), info(NO_OLD_REPOSTS), info(NO_OLD_POSTS)]);
  expect(listedCollections(bluesky)).toStrictEqual([
    "app.bsky.feed.like",
    "app.bsky.feed.repost",
    "app.bsky.feed.post",
    "app.bsky.feed.threadgate",
    "app.bsky.feed.threadgate",
  ]);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect(bluesky.replySettings()).toStrictEqual(settings);
});

test("judges reply and quote settings by their own age, not by the age or the existence of their post", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addAccountPost({
    kind: "plain",
    text: "an old post",
    createdAt: createdAgo(400 * DAY),
  });
  const replySettings = bluesky.addReplySettings({ post, createdAt: createdAgo(300 * DAY) });
  const quoteSettings = bluesky.addQuoteSettings({
    post: goneAccountPost("gone", createdAgo(400 * DAY)),
    createdAt: createdAgo(400 * DAY),
  });
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    info(NO_OLD_LIKES),
    info(NO_OLD_REPOSTS),
    deleting("post", post),
    info("Deleted 1 of 1 post older than one year"),
    info(NO_OLD_REPLY_SETTINGS),
    deleting("quote settings", quoteSettings),
    info("Deleted 1 of 1 quote settings older than one year"),
  ]);
  expect(bluesky.accountPosts()).toStrictEqual([]);
  expect(bluesky.replySettings()).toStrictEqual([replySettings]);
  expect(bluesky.quoteSettings()).toStrictEqual([]);
});

test("reports no old records of any kind and neither logs in nor deletes when every record is younger than one year", async () => {
  const bluesky = newBluesky();
  const subject = bluesky.addPost("a post");
  bluesky.addLike({ subject: subject.uri, createdAt: createdAgo(1 * DAY) });
  bluesky.addRepost({ subject: subject.uri, createdAt: createdAgo(364 * DAY) });
  const post = bluesky.addAccountPost({
    kind: "plain",
    text: "an account post",
    createdAt: createdAgo(1 * DAY),
  });
  bluesky.addReplySettings({ post, createdAt: createdAgo(364 * DAY) });
  bluesky.addQuoteSettings({ post, createdAt: createdAgo(1 * DAY) });
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    info(NO_OLD_LIKES),
    info(NO_OLD_REPOSTS),
    ...noOldPostsOrSettings,
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(0);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
});

test("logs in after listing posts when only a post is older than one year", async () => {
  const bluesky = newBluesky();
  const subject = bluesky.addPost("a post");
  const like = bluesky.addLike({ subject: subject.uri, createdAt: createdAgo(1 * DAY) });
  const repost = bluesky.addRepost({ subject: subject.uri, createdAt: createdAgo(364 * DAY) });
  const post = bluesky.addAccountPost({
    kind: "plain",
    text: "an old account post",
    createdAt: createdAgo(400 * DAY),
  });
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(requestPhases(bluesky)).toStrictEqual([
    "listRecords app.bsky.feed.like",
    "listRecords app.bsky.feed.repost",
    "listRecords app.bsky.feed.post",
    "server.createSession",
    "repo.applyWrites",
    "listRecords app.bsky.feed.threadgate",
    "listRecords app.bsky.feed.postgate",
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(entries).toStrictEqual([
    info(NO_OLD_LIKES),
    info(NO_OLD_REPOSTS),
    deleting("post", post),
    info("Deleted 1 of 1 post older than one year"),
    info(NO_OLD_REPLY_SETTINGS),
    info(NO_OLD_QUOTE_SETTINGS),
  ]);
  expect(bluesky.likes()).toStrictEqual([like]);
  expect(bluesky.reposts()).toStrictEqual([repost]);
  expect(bluesky.accountPosts()).toStrictEqual([]);
});

test("deletes only the datable old post and reports the undatable posts as skipped", async () => {
  const bluesky = newBluesky();
  const noDate = bluesky.addAccountPost({
    kind: "plain",
    text: "a post without a date",
  } as unknown as NewAccountPost);
  const notADate = bluesky.addAccountPost({
    kind: "plain",
    text: "a post with a bad date",
    createdAt: "not-a-date",
  });
  const old = bluesky.addAccountPost({
    kind: "plain",
    text: "an old account post",
    createdAt: createdAgo(400 * DAY),
  });
  const { entries, run } = newRun(bluesky, APP_PASSWORD);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    info(NO_OLD_LIKES),
    info(NO_OLD_REPOSTS),
    deleting("post", old),
    info("Skipped 2 posts without a valid creation time"),
    info("Deleted 1 of 1 post older than one year"),
    info(NO_OLD_REPLY_SETTINGS),
    info(NO_OLD_QUOTE_SETTINGS),
  ]);
  expect(bluesky.accountPosts()).toStrictEqual([noDate, notADate]);
});
