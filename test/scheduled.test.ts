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
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([NO_OLD_LIKES]);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(0);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(0);
  expect(bluesky.likes()).toHaveLength(2);
});

test("reports no old likes after a single listing request when the account has no likes", async () => {
  const bluesky = newBluesky();
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(log.mock.calls.map((args) => args.join(" "))).toStrictEqual([NO_OLD_LIKES]);
  expect(bluesky.requests().map((request) => new URL(request.url).pathname)).toStrictEqual([
    "/xrpc/com.atproto.repo.listRecords",
  ]);
});

test("stays within 42 requests when deleting 1,256 old likes out of 3,300", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addPost("a post");
  for (let i = 0; i < 3300; i++) {
    bluesky.addLike({ subject: post.uri, createdAt: createdAgo(i < 1256 ? 400 * DAY : 10 * DAY) });
  }
  bluesky.intercept();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const error = await runScheduled({ ...env, BLUESKY_APP_PASSWORD: APP_PASSWORD });

  expect(error).toBeUndefined();
  expect(requestsTo(bluesky, "com.atproto.repo.listRecords")).toHaveLength(34);
  expect(requestsTo(bluesky, "com.atproto.server.createSession")).toHaveLength(1);
  expect(requestsTo(bluesky, "com.atproto.repo.applyWrites")).toHaveLength(7);
  expect(bluesky.requests()).toHaveLength(42);
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
  expect(log.mock.calls.map((args) => args.join(" ")).at(-1)).toBe(
    "Deleted 250 of 250 likes older than one year",
  );
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
