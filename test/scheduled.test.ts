// Feature: feature/delete-old-likes.feature
// Cycle 5: wire the daily run.
import { createScheduledController, env } from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";
import worker from "../src/index";
import { createFakeBluesky } from "./fake-bluesky";

const RUN_START = Date.parse("2026-11-08T03:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const APP_PASSWORD = "test-app-password";
const NO_OLD_LIKES = "No likes are older than one year";
const NO_OLD_REPOSTS = "No reposts are older than one year";

afterEach(() => {
  vi.restoreAllMocks();
});

const createdAgo = (ms: number) => new Date(RUN_START - ms).toISOString();

function newBluesky() {
  return createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: APP_PASSWORD,
  });
}

async function runScheduled(workerEnv: typeof env): Promise<unknown> {
  const controller = createScheduledController({ scheduledTime: RUN_START, cron: "0 3 * * *" });
  const outcome = await worker.scheduled(controller, workerEnv).then(
    () => undefined,
    (error: unknown) => error ?? new Error("rejected without a reason"),
  );
  return outcome;
}

const requestsTo = (bluesky: ReturnType<typeof newBluesky>, method: string) =>
  bluesky.requests().filter((request) => new URL(request.url).pathname === `/xrpc/${method}`);

// One entry per run of consecutive requests: listRecords is tagged with its collection, so paging collapses.
function requestPhases(bluesky: ReturnType<typeof newBluesky>): string[] {
  const phases = bluesky.requests().map((request) => {
    const url = new URL(request.url);
    const method = url.pathname.replace("/xrpc/com.atproto.", "");
    return method === "repo.listRecords"
      ? `listRecords ${url.searchParams.get("collection")}`
      : method;
  });
  return phases.filter((phase, index) => phase !== phases[index - 1]);
}

test("fails loudly and logs no total when listing a page fails", async () => {
  const bluesky = createFakeBluesky({ did: env.BLUESKY_DID, baseUrl: env.BLUESKY_SERVER_URL });
  const post = bluesky.addPost("a post");
  const createdAt = new Date(RUN_START - 400 * DAY).toISOString();
  for (let i = 0; i < 150; i++) {
    bluesky.addLike({ subject: post.uri, createdAt });
  }
  bluesky.failPage({ cursor: "100", status: 500 });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const controller = createScheduledController({ scheduledTime: RUN_START, cron: "0 3 * * *" });

  await expect(worker.scheduled(controller, env)).rejects.toThrow();

  const printed = log.mock.calls.map((args) => args.join(" "));
  expect(printed.filter((line) => /older than one year|No likes are/.test(line))).toStrictEqual([]);
});

test("reports no old likes and neither logs in nor deletes when every like is younger than one year", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLike({ subject: post.uri, createdAt: createdAgo(1 * DAY) });
  bluesky.addLike({ subject: post.uri, createdAt: createdAgo(364 * DAY) });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    NO_OLD_LIKES,
    NO_OLD_REPOSTS,
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(0);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect(bluesky.likes()).toHaveLength(2);
});

test("reports no old likes or reposts after one listing request each when the account has none", async () => {
  const bluesky = newBluesky();
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    NO_OLD_LIKES,
    NO_OLD_REPOSTS,
  ]);
  expect(bluesky.requests().map((request) => new URL(request.url).pathname)).toStrictEqual([
    "/xrpc/com.atproto.repo.listRecords",
    "/xrpc/com.atproto.repo.listRecords",
  ]);
});

test("stays within 43 requests when deleting 1,256 old likes out of 3,300", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  for (let i = 0; i < 3300; i++) {
    bluesky.addLike({ subject: post.uri, createdAt: createdAgo(i < 1256 ? 400 * DAY : 10 * DAY) });
  }
  bluesky.intercept();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(requestsTo(bluesky, "com.atproto.repo.listRecords")).toHaveLength(35);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(7);
  expect(bluesky.requests()).toHaveLength(43);
});

test("keeps the deleted likes logged after a failed batch and deletes the rest on the next run", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const createdAts = Array.from({ length: 450 }, (_, i) => createdAgo(400 * DAY + i * HOUR));
  for (const createdAt of createdAts) {
    bluesky.addLike({ subject: post.uri, createdAt });
  }
  bluesky.failApplyWrites({ call: 2, status: 500 });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const workerEnv = { ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD };

  const error = await runScheduled(workerEnv);

  expect(error).toBeInstanceOf(Error);
  const firstRun = log.mock.calls.map((args) => args.join(" "));
  expect(firstRun).toHaveLength(200);
  expect(firstRun.filter((line) => /older than one year/.test(line))).toStrictEqual([]);
  expect(bluesky.likes().map((like) => like.createdAt)).toStrictEqual(createdAts.slice(0, 250));
  expect([...firstRun, String(error)].join("\n")).not.toContain(APP_PASSWORD);

  log.mockClear();
  const secondError = await runScheduled(workerEnv);

  expect(secondError).toBeUndefined();
  const secondRun = log.mock.calls.map((args) => args.join(" "));
  expect(secondRun.slice(-2)).toStrictEqual([
    "Deleted 250 of 250 likes older than one year",
    NO_OLD_REPOSTS,
  ]);
  expect(bluesky.likes()).toStrictEqual([]);
});

test("deletes only the datable old like and reports the undatable likes as skipped", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const noDate = bluesky.addLike({ subject: post.uri, createdAt: "" });
  const notADate = bluesky.addLike({ subject: post.uri, createdAt: "not-a-date" });
  const createdAt = createdAgo(400 * DAY);
  bluesky.addLike({ subject: post.uri, createdAt });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    `${createdAt} ${post.uri}`,
    "Skipped 2 likes without a valid creation time",
    "Deleted 1 of 1 like older than one year",
    NO_OLD_REPOSTS,
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
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: appPassword });

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("BLUESKY_APP_PASSWORD");
  expect(bluesky.requests()).toStrictEqual([]);
  expect(log).not.toHaveBeenCalled();
});

test("fails without deleting or reporting a total when the login is rejected", async () => {
  const wrongPassword = "wrong-app-password";
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLike({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  bluesky.addLike({ subject: post.uri, createdAt: createdAgo(2 * DAY) });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: wrongPassword });

  expect(error).toBeInstanceOf(Error);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  const printed = log.mock.calls.map((args) => args.join(" "));
  expect(printed.filter((line) => /older than one year|No likes are/.test(line))).toStrictEqual([]);
  expect([...printed, String(error)].join("\n")).not.toContain(wrongPassword);
  expect(bluesky.likes()).toHaveLength(2);
});

test("deletes old likes before listing reposts, then old reposts, with a single login", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const olderLike = createdAgo(401 * DAY);
  const newerLike = createdAgo(400 * DAY);
  const olderRepost = createdAgo(401 * DAY + HOUR);
  const newerRepost = createdAgo(400 * DAY + HOUR);
  bluesky.addLike({ subject: post.uri, createdAt: newerLike });
  bluesky.addLike({ subject: post.uri, createdAt: olderLike });
  bluesky.addRepost({ subject: post.uri, createdAt: newerRepost });
  bluesky.addRepost({ subject: post.uri, createdAt: olderRepost });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(requestPhases(bluesky)).toStrictEqual([
    "listRecords app.bsky.feed.like",
    "server.createSession",
    "repo.applyWrites",
    "listRecords app.bsky.feed.repost",
    "repo.applyWrites",
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    `${olderLike} ${post.uri}`,
    `${newerLike} ${post.uri}`,
    "Deleted 2 of 2 likes older than one year",
    `${olderRepost} ${post.uri}`,
    `${newerRepost} ${post.uri}`,
    "Deleted 2 of 2 reposts older than one year",
  ]);
  expect(bluesky.likes()).toStrictEqual([]);
  expect(bluesky.reposts()).toStrictEqual([]);
});

test("reports no old reposts and neither logs in nor deletes when every repost is younger than one year", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(1 * DAY) });
  bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(364 * DAY) });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    NO_OLD_LIKES,
    NO_OLD_REPOSTS,
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(0);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect(bluesky.reposts()).toHaveLength(2);
});

test("logs in after listing reposts when only a repost is older than one year", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const like = bluesky.addLike({ subject: post.uri, createdAt: createdAgo(1 * DAY) });
  const repostCreatedAt = createdAgo(400 * DAY);
  bluesky.addRepost({ subject: post.uri, createdAt: repostCreatedAt });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(requestPhases(bluesky)).toStrictEqual([
    "listRecords app.bsky.feed.like",
    "listRecords app.bsky.feed.repost",
    "server.createSession",
    "repo.applyWrites",
  ]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    NO_OLD_LIKES,
    `${repostCreatedAt} ${post.uri}`,
    "Deleted 1 of 1 repost older than one year",
  ]);
  expect(bluesky.likes()).toStrictEqual([like]);
  expect(bluesky.reposts()).toStrictEqual([]);
});

test("stays within 31 requests when deleting 1 old like out of 2,047 and 193 old reposts out of 427", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  for (let i = 0; i < 2047; i++) {
    bluesky.addLike({ subject: post.uri, createdAt: createdAgo(i === 0 ? 400 * DAY : 10 * DAY) });
  }
  for (let i = 0; i < 427; i++) {
    bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(i < 193 ? 400 * DAY : 10 * DAY) });
  }
  bluesky.intercept();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(requestsTo(bluesky, "com.atproto.repo.listRecords")).toHaveLength(28);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(2);
  expect(bluesky.requests()).toHaveLength(31);
});

// The fake records only method and url, so write bodies are read from the intercepted fetch calls.
async function appliedWrites(): Promise<{ $type: string; collection: string }[][]> {
  const batches: { $type: string; collection: string }[][] = [];
  for (const [input, init] of vi.mocked(globalThis.fetch).mock.calls) {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === "/xrpc/com.atproto.repo.applyWrites") {
      batches.push(
        ((await request.json()) as { writes: { $type: string; collection: string }[] }).writes,
      );
    }
  }
  return batches;
}

const listedCollections = (bluesky: ReturnType<typeof newBluesky>) =>
  requestsTo(bluesky, "com.atproto.repo.listRecords").map((request) =>
    new URL(request.url).searchParams.get("collection"),
  );

test("keeps the deleted likes and reposts logged after a failed repost batch and deletes the rest on the next run", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const likeCreatedAt = createdAgo(400 * DAY);
  bluesky.addLike({ subject: post.uri, createdAt: likeCreatedAt });
  const repostCreatedAts = Array.from({ length: 450 }, (_, i) => createdAgo(400 * DAY + i * HOUR));
  for (const createdAt of repostCreatedAts) {
    bluesky.addRepost({ subject: post.uri, createdAt });
  }
  bluesky.failApplyWrites({ call: 3, status: 500 });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const workerEnv = { ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD };

  const error = await runScheduled(workerEnv);

  expect(error).toBeInstanceOf(Error);
  const firstRun = log.mock.calls.map((args) => args.join(" "));
  expect(firstRun).toHaveLength(202);
  expect(firstRun.slice(0, 2)).toStrictEqual([
    `${likeCreatedAt} ${post.uri}`,
    "Deleted 1 of 1 like older than one year",
  ]);
  expect(firstRun.slice(2)).toStrictEqual(
    repostCreatedAts
      .slice(250)
      .reverse()
      .map((createdAt) => `${createdAt} ${post.uri}`),
  );
  expect(firstRun.filter((line) => /reposts older than one year/.test(line))).toStrictEqual([]);
  expect(bluesky.likes()).toStrictEqual([]);
  expect(bluesky.reposts().map((repost) => repost.createdAt)).toStrictEqual(
    repostCreatedAts.slice(0, 250),
  );

  log.mockClear();
  const secondError = await runScheduled(workerEnv);

  expect(secondError).toBeUndefined();
  const secondRun = log.mock.calls.map((args) => args.join(" "));
  expect(secondRun).toHaveLength(252);
  expect(secondRun[0]).toBe(NO_OLD_LIKES);
  expect(secondRun.at(-1)).toBe("Deleted 250 of 250 reposts older than one year");
  expect(bluesky.reposts()).toStrictEqual([]);
});

test("fails loudly, lists no reposts and logs no total when listing a likes page fails", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  for (let i = 0; i < 150; i++) {
    bluesky.addLike({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  }
  bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  bluesky.failPage({ cursor: "100", status: 500 });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeInstanceOf(Error);
  expect(listedCollections(bluesky)).toStrictEqual(["app.bsky.feed.like", "app.bsky.feed.like"]);
  const printed = log.mock.calls.map((args) => args.join(" "));
  expect(
    printed.filter((line) => /older than one year|No (likes|reposts) are/.test(line)),
  ).toStrictEqual([]);
  expect(bluesky.reposts()).toHaveLength(1);
});

test("lists and deletes only likes and reposts, one collection per write batch, across a mixed run", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  for (let i = 0; i < 3; i++) {
    bluesky.addLike({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
    bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  }
  bluesky.addQuotePost({ quoted: post.uri, createdAt: createdAgo(400 * DAY) });
  bluesky.intercept();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  const allowed = ["app.bsky.feed.like", "app.bsky.feed.repost"];
  const listed = listedCollections(bluesky);
  expect(listed.length).toBeGreaterThan(0);
  expect(listed.filter((collection) => !allowed.includes(collection ?? ""))).toStrictEqual([]);
  const batches = await appliedWrites();
  expect(
    batches.map((writes) => [...new Set(writes.map((write) => write.collection))]),
  ).toStrictEqual([["app.bsky.feed.like"], ["app.bsky.feed.repost"]]);
  expect(
    batches.flat().filter((write) => write.$type !== "com.atproto.repo.applyWrites#delete"),
  ).toStrictEqual([]);
  expect(bluesky.quotePosts()).toHaveLength(1);
});

test("deletes the old repost but leaves an old quote post and names no post collection in any request", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const quote = bluesky.addQuotePost({ quoted: post.uri, createdAt: createdAgo(400 * DAY) });
  const repostCreatedAt = createdAgo(400 * DAY);
  bluesky.addRepost({ subject: post.uri, createdAt: repostCreatedAt });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    NO_OLD_LIKES,
    `${repostCreatedAt} ${post.uri}`,
    "Deleted 1 of 1 repost older than one year",
  ]);
  expect(bluesky.reposts()).toStrictEqual([]);
  expect(bluesky.quotePosts()).toStrictEqual([quote]);
  expect(
    bluesky.requests().filter((request) => request.url.includes("app.bsky.feed.post")),
  ).toStrictEqual([]);
  const writes = (await appliedWrites()).flat();
  expect(writes).toHaveLength(1);
  expect(writes.filter((write) => write.collection === "app.bsky.feed.post")).toStrictEqual([]);
});

test("fails after the likes total, with no reposts total or repost write, when listing a repost page fails", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  const likeCreatedAt = createdAgo(400 * DAY);
  bluesky.addLike({ subject: post.uri, createdAt: likeCreatedAt });
  for (let i = 0; i < 150; i++) {
    bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  }
  bluesky.failPage({ cursor: "100", status: 500 });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeInstanceOf(Error);
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    `${likeCreatedAt} ${post.uri}`,
    "Deleted 1 of 1 like older than one year",
  ]);
  expect(listedCollections(bluesky)).toStrictEqual([
    "app.bsky.feed.like",
    "app.bsky.feed.like",
    "app.bsky.feed.repost",
    "app.bsky.feed.repost",
  ]);
  const batches = await appliedWrites();
  expect(batches.map((writes) => writes.map((write) => write.collection))).toStrictEqual([
    ["app.bsky.feed.like"],
  ]);
  expect(bluesky.reposts()).toHaveLength(150);
});

test("fails with no reposts total and keeps the repost when the login is rejected in the repost phase", async () => {
  const wrongPassword = "wrong-app-password";
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  bluesky.addLike({ subject: post.uri, createdAt: createdAgo(1 * DAY) });
  bluesky.addRepost({ subject: post.uri, createdAt: createdAgo(400 * DAY) });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: wrongPassword });

  expect(error).toBeInstanceOf(Error);
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([NO_OLD_LIKES]);
  expect(requestPhases(bluesky)).toStrictEqual([
    "listRecords app.bsky.feed.like",
    "listRecords app.bsky.feed.repost",
    "server.createSession",
  ]);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect([...log.mock.calls.map((args) => args.join(" ")), String(error)].join("\n")).not.toContain(
    wrongPassword,
  );
  expect(bluesky.reposts()).toHaveLength(1);
});

test("deletes only the datable old repost and reports the undatable reposts as skipped", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  type NewRepost = Parameters<typeof bluesky.addRepost>[0];
  const noDate = bluesky.addRepost({ subject: post.uri } as unknown as NewRepost);
  const notADate = bluesky.addRepost({ subject: post.uri, createdAt: "not-a-date" });
  const createdAt = createdAgo(400 * DAY);
  bluesky.addRepost({ subject: post.uri, createdAt });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([
    NO_OLD_LIKES,
    `${createdAt} ${post.uri}`,
    "Skipped 2 reposts without a valid creation time",
    "Deleted 1 of 1 repost older than one year",
  ]);
  expect(bluesky.reposts()).toStrictEqual([noDate, notADate]);
});
