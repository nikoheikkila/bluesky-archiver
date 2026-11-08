// Feature: feature/dry-run-old-likes.feature
// Cycle 2: list every like across all pages.
import { afterEach, expect, test, vi } from "vitest";
import { listLikes } from "../src/bluesky";
import { createFakeBluesky } from "./fake-bluesky";

const DID = "did:plc:fakeaccount000000000000";
const OTHER_DID = "did:plc:someoneelse0000000000000";
const BASE_URL = "https://fake-bluesky.test";

afterEach(() => {
  vi.restoreAllMocks();
});

test.each([
  { name: "lists 250 likes in 4 requests", likeCount: 250, requestCount: 4 },
  { name: "lists 3300 likes in 34 requests", likeCount: 3300, requestCount: 34 },
])("$name", async ({ likeCount, requestCount }) => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const post = bluesky.addPost("a post");
  const likes = Array.from({ length: likeCount }, () =>
    bluesky.addLike({ subject: post.uri, createdAt: "2025-01-01T00:00:00.000Z" }),
  );
  bluesky.intercept();

  const records = await listLikes({ baseUrl: BASE_URL, did: DID });

  expect(records).toHaveLength(likeCount);
  expect(records.map((record) => record.uri).sort()).toStrictEqual(likes.map((like) => like.uri).sort());
  expect(bluesky.requests()).toHaveLength(requestCount);
  expect(bluesky.requests().map(({ method, url }) => [method, new URL(url).pathname])).toStrictEqual(
    Array(requestCount).fill(["GET", "/xrpc/com.atproto.repo.listRecords"]),
  );
});

test("asks the server only for the configured account's likes", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const post = bluesky.addPost("a post");
  for (let i = 0; i < 3; i++) bluesky.addLike({ subject: post.uri, createdAt: "2025-01-01T00:00:00.000Z" });
  bluesky.intercept();

  const records = await listLikes({ baseUrl: BASE_URL, did: DID });

  expect(records).toHaveLength(3);
  for (const { url } of bluesky.requests()) {
    const params = new URL(url).searchParams;
    expect(params.get("repo")).toBe(DID);
    expect(params.get("collection")).toBe("app.bsky.feed.like");
  }
  await expect(listLikes({ baseUrl: BASE_URL, did: OTHER_DID })).rejects.toThrow();
});
