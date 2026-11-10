// Review fix: every request the Worker sends gets a timeout that aborts it.
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import type { Fetch } from "../src/bluesky";
import { REQUEST_TIMEOUT_MS, withRequestTimeout } from "../src/timeout";
import { createWorker } from "../src/worker";
import { DAY } from "./constants";
import { createFakeBluesky } from "./fake-bluesky";

const RUN_START = Date.parse("2026-11-08T03:00:00Z");
const URL_UNDER_TEST = "https://bsky.example/xrpc/com.atproto.repo.listRecords";

const neverResolvesUntilAborted: Fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

test("rejects with a TimeoutError when the request does not finish in time", async () => {
  const fetch = withRequestTimeout(neverResolvesUntilAborted, 10);

  await expect(fetch(URL_UNDER_TEST)).rejects.toMatchObject({ name: "TimeoutError" });
});

test("passes the response of the wrapped fetch through unchanged", async () => {
  const response = new Response("ok");
  const fetch = withRequestTimeout(async () => response, 10);

  await expect(fetch(URL_UNDER_TEST)).resolves.toBe(response);
});

test("keeps the request's method and body and adds an abort signal", async () => {
  const inits: (RequestInit | undefined)[] = [];
  const fetch = withRequestTimeout(async (_input, init) => {
    inits.push(init);
    return new Response("ok");
  }, 10);

  await expect(fetch(URL_UNDER_TEST, { method: "POST", body: "payload" })).resolves.toBeInstanceOf(
    Response,
  );

  expect(inits).toHaveLength(1);
  expect(inits[0]?.method).toBe("POST");
  expect(inits[0]?.body).toBe("payload");
  expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
});

test("gives getRecord, createSession, listRecords and applyWrites requests an abort signal in a run", async () => {
  const bluesky = createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: "test-app-password",
  });
  const post = bluesky.addPost("a post");
  bluesky.addLike({
    subject: post.uri,
    createdAt: new Date(RUN_START - 400 * DAY).toISOString(),
  });
  const inits: (RequestInit | undefined)[] = [];
  const worker = createWorker({
    fetch: (input, init) => {
      inits.push(init);
      return bluesky.fetch(input, init);
    },
    log: () => {},
  });
  const controller = createScheduledController({ scheduledTime: RUN_START, cron: "0 3 * * *" });

  await worker.scheduled(controller, { ...env, BLUESKY_APP_PASSWORD: "test-app-password" });

  expect(inits).toHaveLength(bluesky.requests().length);
  expect(inits.map((init) => init?.signal instanceof AbortSignal)).toStrictEqual(
    Array(bluesky.requests().length).fill(true),
  );
});

test("stops the run at a request that never finishes: the run rejects with a TimeoutError and no later kind sends a request", async () => {
  const inputs: (URL | string)[] = [];
  const neverFinishes: Fetch = (input, init) =>
    new Promise<Response>((_resolve, reject) => {
      inputs.push(input);
      const fallback = setTimeout(() => reject(new Error("the request was never aborted")), 1000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(fallback);
        reject(init.signal?.reason);
      });
    });
  const worker = createWorker({ fetch: neverFinishes, log: () => {}, requestTimeoutMs: 10 });
  const controller = createScheduledController({ scheduledTime: RUN_START, cron: "0 3 * * *" });

  const run = worker.scheduled(controller, { ...env, BLUESKY_APP_PASSWORD: "test-app-password" });

  await expect(run).rejects.toMatchObject({ name: "TimeoutError" });
  expect(inputs.map((input) => new URL(input).searchParams.get("collection"))).toStrictEqual([
    "app.bsky.actor.profile",
  ]);
});

test("defaults the per-request timeout to 10 seconds", () => {
  expect(REQUEST_TIMEOUT_MS).toBe(10_000);
});

test("gives the session requests of a default run an abort signal that is still open after the run", async () => {
  const bluesky = createFakeBluesky({
    did: env.BLUESKY_DID,
    baseUrl: env.BLUESKY_SERVER_URL,
    appPassword: "test-app-password",
  });
  const post = bluesky.addPost("a post");
  bluesky.addLike({
    subject: post.uri,
    createdAt: new Date(RUN_START - 400 * DAY).toISOString(),
  });
  const recorded: { path: string; signal: AbortSignal | null | undefined }[] = [];
  const worker = createWorker({
    fetch: (input, init) => {
      recorded.push({ path: new URL(input).pathname, signal: init?.signal });
      return bluesky.fetch(input, init);
    },
    log: () => {},
  });
  const controller = createScheduledController({ scheduledTime: RUN_START, cron: "0 3 * * *" });

  await worker.scheduled(controller, { ...env, BLUESKY_APP_PASSWORD: "test-app-password" });

  const signalsOf = (method: string) =>
    recorded.filter(({ path }) => path.endsWith(method)).map(({ signal }) => signal);
  const sessionSignals = [
    ...signalsOf("com.atproto.server.createSession"),
    ...signalsOf("com.atproto.repo.applyWrites"),
  ];
  expect(sessionSignals.map((signal) => signal instanceof AbortSignal)).toStrictEqual([true, true]);
  expect(recorded.map(({ signal }) => signal?.aborted)).toStrictEqual(
    Array(recorded.length).fill(false),
  );
});
