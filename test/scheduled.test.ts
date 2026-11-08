// Feature: feature/dry-run-old-likes.feature
// Cycle 6: wire the scheduled run.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";
import worker from "../src/index";
import { createFakeBluesky } from "./fake-bluesky";

const RUN_START = Date.parse("2026-11-08T03:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.restoreAllMocks();
});

test("fails loudly and logs no total when listing a page fails", async () => {
  const bluesky = createFakeBluesky({ did: env.BLUESKY_DID, baseUrl: env.BLUESKY_SERVER_URL });
  const post = bluesky.addPost("a post");
  const createdAt = new Date(RUN_START - 400 * DAY).toISOString();
  for (let i = 0; i < 150; i++) bluesky.addLike({ subject: post.uri, createdAt });
  bluesky.failPage({ cursor: "100", status: 500 });
  bluesky.intercept();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const controller = createScheduledController({ scheduledTime: RUN_START, cron: "0 3 * * *" });
  const ctx = createExecutionContext();

  await expect(worker.scheduled(controller, env, ctx)).rejects.toThrow();
  await waitOnExecutionContext(ctx);

  const printed = log.mock.calls.map((args) => args.join(" "));
  expect(printed.filter((line) => /older than one year|No likes are/.test(line))).toStrictEqual([]);
});
