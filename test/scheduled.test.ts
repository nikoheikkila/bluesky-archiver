// Feature: feature/delete-old-likes.feature
// Cycle 5: wire the daily run.
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import type { RecordNoun } from "../src/report";
import { createWorker, type LogEntry } from "../src/worker";
import { createdAgo, DAY, HOUR, RUN_START, WRONG_PASSWORD } from "./constants";
import type { FakeAccountPost, FakeBluesky, NewAccountPost, NewRepost } from "./fake-bluesky";
import { createEnvBluesky, deletesOf } from "./network";

const OLD_AT = createdAgo(400 * DAY);
// 450 timestamps, newest first, all older than one year: three write batches of at most 200.
const STAGGERED = Array.from({ length: 450 }, (_, i) => createdAgo(400 * DAY + i * HOUR));
const COLLECTIONS = [
  "app.bsky.feed.like",
  "app.bsky.feed.repost",
  "app.bsky.feed.post",
  "app.bsky.feed.threadgate",
  "app.bsky.feed.postgate",
];

const NO_OLD: Record<RecordNoun, string> = {
  like: "No likes are older than one year",
  repost: "No reposts are older than one year",
  post: "No posts are older than one year",
  "reply settings": "No reply settings are older than one year",
  "quote settings": "No quote settings are older than one year",
};
const summary = (
  message: string,
  kind: RecordNoun,
  { found, deleted, skipped }: { found: number; deleted: number; skipped: number },
): LogEntry => ({
  level: "info",
  message,
  fields: { event: "kind_summary", kind, found, deleted, skipped },
});
const noOld = (kind: RecordNoun) =>
  summary(NO_OLD[kind], kind, { found: 0, deleted: 0, skipped: 0 });
const deletedAll = (message: string, kind: RecordNoun, count: number, skipped = 0) =>
  summary(message, kind, { found: count, deleted: count, skipped });
const skippedLine = (message: string, kind: RecordNoun, skipped: number): LogEntry => ({
  level: "info",
  message,
  fields: { event: "records_skipped", kind, skipped },
});
const noOldPostsOrSettings = [noOld("post"), noOld("reply settings"), noOld("quote settings")];
const allNoOld = [noOld("like"), noOld("repost"), ...noOldPostsOrSettings];
const deleting = (noun: RecordNoun, record: { uri: string }): LogEntry => ({
  level: "debug",
  message: `deleting ${noun} ${record.uri}`,
  fields: { event: "record_deleted", kind: noun, uri: record.uri },
});
// The run deletes each batch's records oldest first, which is the reverse of how the fake lists them.
const deletingOldestFirst = (noun: RecordNoun, records: { uri: string }[]) =>
  [...records].reverse().map((record) => deleting(noun, record));
const deletedPost = (post: { uri: string }) => [
  deleting("post", post),
  deletedAll("Deleted 1 of 1 post older than one year", "post", 1),
];

// What the other kinds log around a kind under test when they have nothing old.
const BEFORE: Record<"like" | "repost" | "post", LogEntry[]> = {
  like: [],
  repost: [noOld("like")],
  post: [noOld("like"), noOld("repost")],
};
const AFTER: Record<"like" | "repost" | "post", LogEntry[]> = {
  like: [noOld("repost"), ...noOldPostsOrSettings],
  repost: noOldPostsOrSettings,
  post: [noOld("reply settings"), noOld("quote settings")],
};

const plainPost = (bluesky: FakeBluesky, text: string, createdAt: string) =>
  bluesky.addAccountPost({ kind: "plain", text, createdAt });

/**
 * One scheduled run against the fake, with the app password it is given; `entries` collects its
 * log with levels, and `lines` the same log's messages only.
 */
function newRun(
  bluesky: FakeBluesky,
  options: { password?: string; fetch?: typeof bluesky.fetch } = {},
) {
  // An explicit undefined password is kept: it models an unset Worker secret.
  const password = "password" in options ? options.password : env.BLUESKY_APP_PASSWORD;
  const entries: LogEntry[] = [];
  const lines: string[] = [];
  const worker = createWorker({
    fetch: options.fetch ?? bluesky.fetch,
    log: (entry) => {
      entries.push(entry);
      lines.push(entry.message);
    },
  });
  const controller = createScheduledController({ scheduledTime: RUN_START, cron: "0 3 * * *" });
  const run = () =>
    worker.scheduled(controller, { ...env, BLUESKY_APP_PASSWORD: password as string });
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

const writtenCollections = (bluesky: FakeBluesky) =>
  bluesky.receivedWrites().map((writes) => writes.map((write) => write.collection));

test.each([500, 400])(
  "fails before any other request, logs nothing and deletes nothing when reading the profile fails with HTTP %i",
  async (status) => {
    const bluesky = createEnvBluesky();
    const subject = bluesky.addPost("a post");
    const like = bluesky.addLike({ subject: subject.uri, createdAt: OLD_AT });
    const repost = bluesky.addRepost({ subject: subject.uri, createdAt: OLD_AT });
    const post = plainPost(bluesky, "an old account post", OLD_AT);
    const replySettings = bluesky.addReplySettings({ post, createdAt: OLD_AT });
    const quoteSettings = bluesky.addQuoteSettings({ post, createdAt: OLD_AT });
    bluesky.failProfileRead({ status });
    const { entries, run } = newRun(bluesky);

    await expect(run()).rejects.toThrow();

    expect(
      bluesky.requests().map(({ method, url }) => [method, new URL(url).pathname]),
    ).toStrictEqual([["GET", "/xrpc/com.atproto.repo.getRecord"]]);
    expect(entries).toStrictEqual([]);
    expect(bluesky.likes()).toStrictEqual([like]);
    expect(bluesky.reposts()).toStrictEqual([repost]);
    expect(bluesky.accountPosts()).toStrictEqual([post]);
    expect(bluesky.replySettings()).toStrictEqual([replySettings]);
    expect(bluesky.quoteSettings()).toStrictEqual([quoteSettings]);
  },
);

test.each([
  {
    name: "likes",
    seed: (bluesky: FakeBluesky, subject: string) =>
      bluesky.addLikes([
        { subject, createdAt: createdAgo(1 * DAY) },
        { subject, createdAt: createdAgo(364 * DAY) },
      ]),
    stored: (bluesky: FakeBluesky) => bluesky.likes().length,
    count: 2,
  },
  {
    name: "reposts",
    seed: (bluesky: FakeBluesky, subject: string) =>
      bluesky.addReposts([
        { subject, createdAt: createdAgo(1 * DAY) },
        { subject, createdAt: createdAgo(364 * DAY) },
      ]),
    stored: (bluesky: FakeBluesky) => bluesky.reposts().length,
    count: 2,
  },
  {
    name: "records of every kind",
    seed: (bluesky: FakeBluesky, subject: string) => {
      bluesky.addLike({ subject, createdAt: createdAgo(1 * DAY) });
      bluesky.addRepost({ subject, createdAt: createdAgo(364 * DAY) });
      const post = plainPost(bluesky, "an account post", createdAgo(1 * DAY));
      bluesky.addReplySettings({ post, createdAt: createdAgo(364 * DAY) });
      bluesky.addQuoteSettings({ post, createdAt: createdAgo(1 * DAY) });
    },
    stored: (bluesky: FakeBluesky) =>
      bluesky.likes().length +
      bluesky.reposts().length +
      bluesky.accountPosts().length +
      bluesky.replySettings().length +
      bluesky.quoteSettings().length,
    count: 5,
  },
])(
  "reports no old records and neither logs in nor deletes when every one of the $name is younger than one year",
  async ({ seed, stored, count }) => {
    const bluesky = createEnvBluesky();
    seed(bluesky, bluesky.addPost("a post").uri);
    const { entries, run } = newRun(bluesky);

    await expect(run()).resolves.toBeUndefined();

    expect(entries).toStrictEqual(allNoOld);
    expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(0);
    expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
    expect(stored(bluesky)).toBe(count);
  },
);

test("reports nothing old after one listing request per collection when the account has none", async () => {
  const bluesky = createEnvBluesky();
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual(allNoOld);
  expect(listedCollections(bluesky)).toStrictEqual(COLLECTIONS);
  expect(bluesky.requests()).toHaveLength(6);
});

test("stays within 42 requests when deleting 2 old likes out of 2,056 and 326 old posts out of 662", async () => {
  const bluesky = createEnvBluesky();
  const post = bluesky.addPost("a post");
  const old = { subject: post.uri, createdAt: OLD_AT };
  const young = { subject: post.uri, createdAt: createdAgo(10 * DAY) };
  bluesky.addLikes([old, old, ...Array(2054).fill(young)]);
  bluesky.addReposts(Array(235).fill(young));
  const accountPosts = [...Array(326).fill(OLD_AT), ...Array(336).fill(createdAgo(10 * DAY))].map(
    (createdAt: string) => plainPost(bluesky, "an account post", createdAt),
  );
  bluesky.addReplySettings({
    post: accountPosts[661] as FakeAccountPost,
    createdAt: createdAgo(10 * DAY),
  });
  const { run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(requestsTo(bluesky, "com.atproto.repo.listRecords")).toHaveLength(37);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(3);
  expect(bluesky.requests()).toHaveLength(42);
});

test.each([
  {
    kind: "like" as const,
    plural: "likes",
    failCall: 2,
    olderLikes: 0,
    firstAhead: (): LogEntry[] => [],
    seed: (bluesky: FakeBluesky, subject: string) =>
      bluesky.addLikes(STAGGERED.map((createdAt) => ({ subject, createdAt }))),
    stored: (bluesky: FakeBluesky) => bluesky.likes(),
  },
  {
    kind: "repost" as const,
    plural: "reposts",
    failCall: 3,
    olderLikes: 1,
    firstAhead: ([like]: { uri: string }[]): LogEntry[] => [
      deleting("like", like as { uri: string }),
      deletedAll("Deleted 1 of 1 like older than one year", "like", 1),
    ],
    seed: (bluesky: FakeBluesky, subject: string) =>
      bluesky.addReposts(STAGGERED.map((createdAt) => ({ subject, createdAt }))),
    stored: (bluesky: FakeBluesky) => bluesky.reposts(),
  },
  {
    kind: "post" as const,
    plural: "posts",
    failCall: 3,
    olderLikes: 1,
    firstAhead: ([like]: { uri: string }[]): LogEntry[] => [
      deleting("like", like as { uri: string }),
      deletedAll("Deleted 1 of 1 like older than one year", "like", 1),
      noOld("repost"),
    ],
    seed: (bluesky: FakeBluesky) =>
      STAGGERED.map((createdAt) => plainPost(bluesky, "an account post", createdAt)),
    stored: (bluesky: FakeBluesky) => bluesky.accountPosts(),
  },
])(
  "keeps the deleted $plural logged after a failed batch and deletes the rest on the next run",
  async ({ kind, plural, failCall, olderLikes, firstAhead, seed, stored }) => {
    const bluesky = createEnvBluesky();
    const subject = bluesky.addPost("a post");
    const olderLiked = bluesky.addLikes(
      Array(olderLikes).fill({ subject: subject.uri, createdAt: OLD_AT }),
    );
    const records = seed(bluesky, subject.uri);
    bluesky.failApplyWrites({ call: failCall, status: 500 });
    const firstRun = newRun(bluesky);

    const error = await firstRun.run().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(firstRun.entries).toStrictEqual([
      ...firstAhead(olderLiked),
      ...deletingOldestFirst(kind, records.slice(250)),
    ]);
    expect(listedCollections(bluesky)).not.toContain("app.bsky.feed.threadgate");
    expect(listedCollections(bluesky)).not.toContain("app.bsky.feed.postgate");
    expect(
      olderLiked.filter(({ uri }) => bluesky.likes().some((like) => like.uri === uri)),
    ).toStrictEqual([]);
    expect(stored(bluesky).map((record) => record.createdAt)).toStrictEqual(
      STAGGERED.slice(0, 250),
    );
    expect([...firstRun.lines, String(error)].join("\n")).not.toContain(env.BLUESKY_APP_PASSWORD);

    const secondRun = newRun(bluesky);

    await expect(secondRun.run()).resolves.toBeUndefined();

    expect(secondRun.entries).toStrictEqual([
      ...BEFORE[kind],
      ...deletingOldestFirst(kind, records.slice(0, 250)),
      deletedAll(`Deleted 250 of 250 ${plural} older than one year`, kind, 250),
      ...AFTER[kind],
    ]);
    expect(stored(bluesky)).toStrictEqual([]);
  },
);

test.each([
  {
    kind: "like" as const,
    plural: "likes",
    seed: (bluesky: FakeBluesky, subject: string) =>
      bluesky.addLikes([
        { subject, createdAt: "" },
        { subject, createdAt: "not-a-date" },
        { subject, createdAt: OLD_AT },
      ]),
    stored: (bluesky: FakeBluesky) => bluesky.likes(),
  },
  {
    kind: "repost" as const,
    plural: "reposts",
    seed: (bluesky: FakeBluesky, subject: string) =>
      bluesky.addReposts([
        { subject } as unknown as NewRepost,
        { subject, createdAt: "not-a-date" },
        { subject, createdAt: OLD_AT },
      ]),
    stored: (bluesky: FakeBluesky) => bluesky.reposts(),
  },
  {
    kind: "post" as const,
    plural: "posts",
    seed: (bluesky: FakeBluesky) => [
      bluesky.addAccountPost({
        kind: "plain",
        text: "a post without a date",
      } as unknown as NewAccountPost),
      plainPost(bluesky, "a post with a bad date", "not-a-date"),
      plainPost(bluesky, "an old account post", OLD_AT),
    ],
    stored: (bluesky: FakeBluesky) => bluesky.accountPosts(),
  },
])(
  "deletes only the datable old $kind and reports the undatable $plural as skipped",
  async ({ kind, plural, seed, stored }) => {
    const bluesky = createEnvBluesky();
    const [noDate, notADate, old] = seed(bluesky, bluesky.addPost("a post").uri) as unknown as [
      { uri: string },
      { uri: string },
      { uri: string },
    ];
    const { entries, run } = newRun(bluesky);

    await expect(run()).resolves.toBeUndefined();

    expect(entries).toStrictEqual([
      ...BEFORE[kind],
      deleting(kind, old),
      skippedLine(`Skipped 2 ${plural} without a valid creation time`, kind, 2),
      deletedAll(`Deleted 1 of 1 ${kind} older than one year`, kind, 1, 2),
      ...AFTER[kind],
    ]);
    expect(stored(bluesky)).toStrictEqual([noDate, notADate]);
  },
);

test.each([
  // The generated Env declares the secret as a string; an unset Worker secret is undefined at runtime.
  { label: "undefined", password: undefined as unknown as string },
  { label: "an empty string", password: "" },
])("fails before any request when BLUESKY_APP_PASSWORD is $label", async ({ password }) => {
  const bluesky = createEnvBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLike({ subject: post.uri, createdAt: OLD_AT });
  const { lines, run } = newRun(bluesky, { password });

  await expect(run()).rejects.toThrow("BLUESKY_APP_PASSWORD");

  expect(bluesky.requests()).toStrictEqual([]);
  expect(lines).toStrictEqual([]);
});

test("fails without deleting or reporting a total when the login is rejected", async () => {
  const bluesky = createEnvBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLikes([
    { subject: post.uri, createdAt: OLD_AT },
    { subject: post.uri, createdAt: createdAgo(2 * DAY) },
  ]);
  const { lines, run } = newRun(bluesky, { password: WRONG_PASSWORD });

  const error = await run().catch((e: unknown) => e);

  expect(error).toBeInstanceOf(Error);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect(lines.filter((line) => /older than one year|No likes are/.test(line))).toStrictEqual([]);
  expect([...lines, String(error)].join("\n")).not.toContain(WRONG_PASSWORD);
  expect(bluesky.likes()).toHaveLength(2);
});

test("deletes old likes before listing reposts, then old reposts, with a single login", async () => {
  const bluesky = createEnvBluesky();
  const post = bluesky.addPost("a post");
  const [newerLike, olderLike] = bluesky.addLikes([
    { subject: post.uri, createdAt: OLD_AT },
    { subject: post.uri, createdAt: createdAgo(401 * DAY) },
  ]);
  const [newerRepost, olderRepost] = bluesky.addReposts([
    { subject: post.uri, createdAt: createdAgo(400 * DAY + HOUR) },
    { subject: post.uri, createdAt: createdAgo(401 * DAY + HOUR) },
  ]);
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(requestPhases(bluesky)).toStrictEqual([
    "repo.getRecord",
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
    deletedAll("Deleted 2 of 2 likes older than one year", "like", 2),
    deleting("repost", olderRepost),
    deleting("repost", newerRepost),
    deletedAll("Deleted 2 of 2 reposts older than one year", "repost", 2),
    ...noOldPostsOrSettings,
  ]);
  expect(bluesky.likes()).toStrictEqual([]);
  expect(bluesky.reposts()).toStrictEqual([]);
});

test("logs in after listing reposts when only a repost is older than one year", async () => {
  const bluesky = createEnvBluesky();
  const post = bluesky.addPost("a post");
  const like = bluesky.addLike({ subject: post.uri, createdAt: createdAgo(1 * DAY) });
  const repost = bluesky.addRepost({ subject: post.uri, createdAt: OLD_AT });
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(requestPhases(bluesky)).toStrictEqual([
    "repo.getRecord",
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
    noOld("like"),
    deleting("repost", repost),
    deletedAll("Deleted 1 of 1 repost older than one year", "repost", 1),
    ...noOldPostsOrSettings,
  ]);
  expect(bluesky.likes()).toStrictEqual([like]);
  expect(bluesky.reposts()).toStrictEqual([]);
});

test("fails loudly, lists no reposts and logs no total when listing a likes page fails", async () => {
  const bluesky = createEnvBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLikes(Array(150).fill({ subject: post.uri, createdAt: OLD_AT }));
  bluesky.addRepost({ subject: post.uri, createdAt: OLD_AT });
  bluesky.failPage({ cursor: "100", status: 500 });
  const { lines, run } = newRun(bluesky);

  await expect(run()).rejects.toThrow();

  expect(listedCollections(bluesky)).toStrictEqual(["app.bsky.feed.like", "app.bsky.feed.like"]);
  expect(
    lines.filter((line) => /older than one year|No (likes|reposts) are/.test(line)),
  ).toStrictEqual([]);
  expect(bluesky.reposts()).toHaveLength(1);
});

test("lists and deletes only the five collections, one collection per write batch, across a mixed run", async () => {
  const bluesky = createEnvBluesky();
  const post = bluesky.addPost("a post");
  const old = { subject: post.uri, createdAt: OLD_AT };
  bluesky.addLikes(Array(3).fill(old));
  bluesky.addReposts(Array(3).fill(old));
  const accountPost = bluesky.addAccountPost({
    kind: "quote",
    text: "a quote of a post",
    createdAt: OLD_AT,
    quoted: post.uri,
  });
  bluesky.addReplySettings({ post: accountPost, createdAt: OLD_AT });
  bluesky.addQuoteSettings({ post: accountPost, createdAt: OLD_AT });
  const { run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(listedCollections(bluesky)).toStrictEqual(
    COLLECTIONS.flatMap((collection) => [collection, collection]),
  );
  const batches = bluesky.receivedWrites();
  expect(
    batches.map((writes) => [...new Set(writes.map((write) => write.collection))]),
  ).toStrictEqual(COLLECTIONS.map((collection) => [collection]));
  expect(
    batches.flat().filter((write) => write.$type !== "com.atproto.repo.applyWrites#delete"),
  ).toStrictEqual([]);
  expect(bluesky.accountPosts()).toStrictEqual([]);
  expect(bluesky.replySettings()).toStrictEqual([]);
  expect(bluesky.quoteSettings()).toStrictEqual([]);
});

test("deletes the old repost and the old quote post, each in its own write batch", async () => {
  const bluesky = createEnvBluesky();
  const post = bluesky.addPost("a post");
  const quote = bluesky.addAccountPost({
    kind: "quote",
    text: "a quote of a post",
    createdAt: OLD_AT,
    quoted: post.uri,
  });
  const repost = bluesky.addRepost({ subject: post.uri, createdAt: OLD_AT });
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    noOld("like"),
    deleting("repost", repost),
    deletedAll("Deleted 1 of 1 repost older than one year", "repost", 1),
    ...deletedPost(quote),
    noOld("reply settings"),
    noOld("quote settings"),
  ]);
  expect(bluesky.reposts()).toStrictEqual([]);
  expect(bluesky.accountPosts()).toStrictEqual([]);
  expect(writtenCollections(bluesky)).toStrictEqual([
    ["app.bsky.feed.repost"],
    ["app.bsky.feed.post"],
  ]);
});

test("runs every kind in order after one login when one record of each is older than one year", async () => {
  const bluesky = createEnvBluesky();
  const subject = bluesky.addPost("a post");
  bluesky.addLike({ subject: subject.uri, createdAt: OLD_AT });
  bluesky.addRepost({ subject: subject.uri, createdAt: OLD_AT });
  const post = plainPost(bluesky, "an account post", OLD_AT);
  bluesky.addReplySettings({ post, createdAt: OLD_AT });
  bluesky.addQuoteSettings({ post, createdAt: OLD_AT });
  const authorizations: { path: string; authorization: string | null }[] = [];
  const recordingFetch: typeof bluesky.fetch = (input, init) => {
    const request = new Request(input, init);
    authorizations.push({
      path: new URL(request.url).pathname,
      authorization: request.headers.get("Authorization"),
    });
    return bluesky.fetch(input, init);
  };
  const { run } = newRun(bluesky, { fetch: recordingFetch });

  await expect(run()).resolves.toBeUndefined();

  expect(requestPhases(bluesky)).toStrictEqual([
    "repo.getRecord",
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
  const [profileRead] = requestsTo(bluesky, "com.atproto.repo.getRecord");
  expect(Object.fromEntries(new URL(profileRead.url).searchParams)).toStrictEqual({
    repo: env.BLUESKY_DID,
    collection: "app.bsky.actor.profile",
    rkey: "self",
  });
  expect(authorizations[0]).toStrictEqual({
    path: "/xrpc/com.atproto.repo.getRecord",
    authorization: null,
  });
  expect(bluesky.requests()).toHaveLength(17);
});

test("fails after the likes total, with no reposts total or repost write, when listing a repost page fails", async () => {
  const bluesky = createEnvBluesky();
  const post = bluesky.addPost("a post");
  const like = bluesky.addLike({ subject: post.uri, createdAt: OLD_AT });
  bluesky.addReposts(Array(150).fill({ subject: post.uri, createdAt: OLD_AT }));
  bluesky.failPage({ cursor: "100", status: 500 });
  const { entries, run } = newRun(bluesky);

  await expect(run()).rejects.toThrow();

  expect(entries).toStrictEqual([
    deleting("like", like),
    deletedAll("Deleted 1 of 1 like older than one year", "like", 1),
  ]);
  expect(listedCollections(bluesky)).toStrictEqual([
    "app.bsky.feed.like",
    "app.bsky.feed.like",
    "app.bsky.feed.repost",
    "app.bsky.feed.repost",
  ]);
  expect(writtenCollections(bluesky)).toStrictEqual([["app.bsky.feed.like"]]);
  expect(bluesky.reposts()).toHaveLength(150);
});

test("fails with no reposts total and keeps the repost when the login is rejected in the repost phase", async () => {
  const bluesky = createEnvBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLike({ subject: post.uri, createdAt: createdAgo(1 * DAY) });
  bluesky.addRepost({ subject: post.uri, createdAt: OLD_AT });
  const { entries, lines, run } = newRun(bluesky, { password: WRONG_PASSWORD });

  const error = await run().catch((e: unknown) => e);

  expect(error).toBeInstanceOf(Error);
  expect(entries).toStrictEqual([noOld("like")]);
  expect(requestPhases(bluesky)).toStrictEqual([
    "repo.getRecord",
    "listRecords app.bsky.feed.like",
    "listRecords app.bsky.feed.repost",
    "server.createSession",
  ]);
  expect([...lines, String(error)].join("\n")).not.toContain(WRONG_PASSWORD);
  expect(bluesky.reposts()).toHaveLength(1);
});

// A post of the account that is no longer served, so only its settings record is left.
const goneAccountPost = (name: string, createdAt: string): FakeAccountPost => ({
  kind: "plain",
  text: "a post deleted by hand",
  createdAt,
  uri: `at://${env.BLUESKY_DID}/app.bsky.feed.post/${name}`,
});

test("fails after the posts report, with no reply settings total and no postgate request, when listing a reply settings page fails", async () => {
  const bluesky = createEnvBluesky();
  const settings = Array.from({ length: 101 }, (_, i) =>
    bluesky.addReplySettings({ post: goneAccountPost(`gone${i}`, OLD_AT), createdAt: OLD_AT }),
  );
  bluesky.failPage({ cursor: "100", status: 500 });
  const { entries, run } = newRun(bluesky);

  await expect(run()).rejects.toThrow();

  expect(entries).toStrictEqual([noOld("like"), noOld("repost"), noOld("post")]);
  expect(listedCollections(bluesky)).toStrictEqual([
    ...COLLECTIONS.slice(0, 4),
    "app.bsky.feed.threadgate",
  ]);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect(bluesky.replySettings()).toStrictEqual(settings);
});

test("judges reply and quote settings by their own age, not by the age or the existence of their post", async () => {
  const bluesky = createEnvBluesky();
  const post = plainPost(bluesky, "an old post", OLD_AT);
  const replySettings = bluesky.addReplySettings({ post, createdAt: createdAgo(300 * DAY) });
  const quoteSettings = bluesky.addQuoteSettings({
    post: goneAccountPost("gone", OLD_AT),
    createdAt: OLD_AT,
  });
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    noOld("like"),
    noOld("repost"),
    ...deletedPost(post),
    noOld("reply settings"),
    deleting("quote settings", quoteSettings),
    deletedAll("Deleted 1 of 1 quote settings older than one year", "quote settings", 1),
  ]);
  expect(bluesky.accountPosts()).toStrictEqual([]);
  expect(bluesky.replySettings()).toStrictEqual([replySettings]);
  expect(bluesky.quoteSettings()).toStrictEqual([]);
});

test("logs in after listing posts when only a post is older than one year", async () => {
  const bluesky = createEnvBluesky();
  const subject = bluesky.addPost("a post");
  const like = bluesky.addLike({ subject: subject.uri, createdAt: createdAgo(1 * DAY) });
  const repost = bluesky.addRepost({ subject: subject.uri, createdAt: createdAgo(364 * DAY) });
  const post = plainPost(bluesky, "an old account post", OLD_AT);
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(requestPhases(bluesky)).toStrictEqual([
    "repo.getRecord",
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
    noOld("like"),
    noOld("repost"),
    ...deletedPost(post),
    noOld("reply settings"),
    noOld("quote settings"),
  ]);
  expect(bluesky.likes()).toStrictEqual([like]);
  expect(bluesky.reposts()).toStrictEqual([repost]);
  expect(bluesky.accountPosts()).toStrictEqual([]);
});

// Feature: feature/keep-pinned-post.feature
test("keeps the only old post and neither logs in nor deletes when it is pinned", async () => {
  const bluesky = createEnvBluesky();
  const pinned = plainPost(bluesky, "a pinned post", OLD_AT);
  bluesky.pinPost(pinned);
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual(allNoOld);
  expect(requestPhases(bluesky)).toStrictEqual([
    "repo.getRecord",
    "listRecords app.bsky.feed.like",
    "listRecords app.bsky.feed.repost",
    "listRecords app.bsky.feed.post",
    "listRecords app.bsky.feed.threadgate",
    "listRecords app.bsky.feed.postgate",
  ]);
  expect(bluesky.accountPosts()).toStrictEqual([pinned]);
});

test.each([
  {
    name: "the pin has moved to a post younger than one year",
    arrange: (bluesky: FakeBluesky) => {
      const pinned = plainPost(bluesky, "a pinned young post", createdAgo(1 * DAY));
      bluesky.pinPost(pinned);
      return [pinned];
    },
  },
  { name: "the account has no profile record", arrange: () => [] },
  {
    name: "the profile has no pinned post",
    arrange: (bluesky: FakeBluesky) => {
      bluesky.addProfileWithoutPin();
      return [];
    },
  },
  {
    name: "the pinned post belongs to another account",
    arrange: (bluesky: FakeBluesky) => {
      bluesky.pinPost(bluesky.addPost("another account's post"));
      return [];
    },
  },
])("deletes the old post when $name", async ({ arrange }) => {
  const bluesky = createEnvBluesky();
  const old = plainPost(bluesky, "an old post", OLD_AT);
  const kept = arrange(bluesky);
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    noOld("like"),
    noOld("repost"),
    ...deletedPost(old),
    noOld("reply settings"),
    noOld("quote settings"),
  ]);
  expect(bluesky.accountPosts()).toStrictEqual(kept);
});

test("keeps the pinned post when the pinned CID differs from the post's CID", async () => {
  const bluesky = createEnvBluesky();
  const pinned = plainPost(bluesky, "a pinned post", OLD_AT);
  bluesky.pinPost(pinned, { cid: "bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy" });
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual(allNoOld);
  expect(bluesky.accountPosts()).toStrictEqual([pinned]);
});

test("deletes the old settings of the pinned post by their own age and keeps the pinned post", async () => {
  const bluesky = createEnvBluesky();
  const pinned = plainPost(bluesky, "a pinned post", OLD_AT);
  const replySettings = bluesky.addReplySettings({ post: pinned, createdAt: OLD_AT });
  const quoteSettings = bluesky.addQuoteSettings({ post: pinned, createdAt: OLD_AT });
  bluesky.pinPost(pinned);
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(entries).toStrictEqual([
    noOld("like"),
    noOld("repost"),
    noOld("post"),
    deleting("reply settings", replySettings),
    deletedAll("Deleted 1 of 1 reply settings older than one year", "reply settings", 1),
    deleting("quote settings", quoteSettings),
    deletedAll("Deleted 1 of 1 quote settings older than one year", "quote settings", 1),
  ]);
  expect(bluesky.accountPosts()).toStrictEqual([pinned]);
  expect(bluesky.replySettings()).toStrictEqual([]);
  expect(bluesky.quoteSettings()).toStrictEqual([]);
});

test("batches the old posts around the pinned post, oldest first, and never names it", async () => {
  const bluesky = createEnvBluesky();
  const posts = STAGGERED.map((createdAt) => plainPost(bluesky, "an account post", createdAt));
  const oldestFirst = [...posts].reverse();
  const pinned = oldestFirst[200] as FakeAccountPost;
  bluesky.pinPost(pinned);
  const deletable = oldestFirst.filter((post) => post !== pinned);
  const { entries, run } = newRun(bluesky);

  await expect(run()).resolves.toBeUndefined();

  expect(bluesky.receivedWrites()).toStrictEqual([
    deletesOf("app.bsky.feed.post", deletable.slice(0, 200)),
    deletesOf("app.bsky.feed.post", deletable.slice(200, 400)),
    deletesOf("app.bsky.feed.post", deletable.slice(400)),
  ]);
  expect(entries).toStrictEqual([
    noOld("like"),
    noOld("repost"),
    ...deletable.map((post) => deleting("post", post)),
    deletedAll("Deleted 449 of 449 posts older than one year", "post", 449),
    noOld("reply settings"),
    noOld("quote settings"),
  ]);
  expect(bluesky.accountPosts()).toStrictEqual([pinned]);
});
