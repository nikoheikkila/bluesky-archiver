// Feature: feature/delete-old-likes.feature
// Cycles 2-3: list every like across all pages; fail loudly when a request fails.
import { expect, test } from "vitest";
import { listLikes, listRecords } from "../src/bluesky";
import { createFakeBluesky, type FakeBluesky } from "./fake-bluesky";

const DID = "did:plc:fakeaccount000000000000";
const OTHER_DID = "did:plc:someoneelse0000000000000";
const BASE_URL = "https://fake-bluesky.test";
const CREATED_AT = "2025-01-01T00:00:00.000Z";

function blueskyWithLikes(count: number) {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const post = bluesky.addPost("a post");
  const likes = bluesky.addLikes(Array(count).fill({ subject: post.uri, createdAt: CREATED_AT }));
  return { bluesky, likes };
}

const searchParams = (bluesky: FakeBluesky, name: string) =>
  bluesky.requests().map(({ url }) => new URL(url).searchParams.get(name));

test.each([
  { likeCount: 250, requestCount: 4 },
  { likeCount: 3300, requestCount: 34 },
])("lists $likeCount likes in $requestCount requests", async ({ likeCount, requestCount }) => {
  const { bluesky, likes } = blueskyWithLikes(likeCount);

  const records = await listLikes({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch });

  expect(records).toHaveLength(likeCount);
  expect(records.map((record) => record.uri).sort()).toStrictEqual(
    likes.map((like) => like.uri).sort(),
  );
  expect(
    bluesky.requests().map(({ method, url }) => [method, new URL(url).pathname]),
  ).toStrictEqual(Array(requestCount).fill(["GET", "/xrpc/com.atproto.repo.listRecords"]));
});

test("asks the server only for the configured account's likes", async () => {
  const { bluesky } = blueskyWithLikes(3);

  const records = await listLikes({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch });

  expect(records).toHaveLength(3);
  expect(searchParams(bluesky, "repo")).toStrictEqual([DID, DID]);
  expect(searchParams(bluesky, "collection")).toStrictEqual([
    "app.bsky.feed.like",
    "app.bsky.feed.like",
  ]);
});

test("fails naming the request and HTTP 400 when asked for another account's likes", async () => {
  const { bluesky } = blueskyWithLikes(3);

  await expect(
    listLikes({ baseUrl: BASE_URL, did: OTHER_DID, fetch: bluesky.fetch }),
  ).rejects.toThrow(/com\.atproto\.repo\.listRecords.*400/);
});

test("fails loudly naming the request when the server answers a page with an error", async () => {
  const { bluesky } = blueskyWithLikes(250);
  bluesky.failPage({ cursor: "100", status: 500 });

  await expect(listLikes({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch })).rejects.toThrow(
    /com\.atproto\.repo\.listRecords.*500/,
  );
});

test.each([
  { kind: "likes", collection: "app.bsky.feed.like", add: "addLikes" },
  { kind: "reposts", collection: "app.bsky.feed.repost", add: "addReposts" },
] as const)("lists 150 $kind in 3 requests", async ({ collection, add }) => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const post = bluesky.addPost("a post");
  const created = bluesky[add](Array(150).fill({ subject: post.uri, createdAt: CREATED_AT }));

  const records = await listRecords({
    baseUrl: BASE_URL,
    did: DID,
    collection,
    fetch: bluesky.fetch,
  });

  expect(records.map((record) => record.uri).sort()).toStrictEqual(
    created.map((record) => record.uri).sort(),
  );
  expect(searchParams(bluesky, "collection")).toStrictEqual(Array(3).fill(collection));
});
