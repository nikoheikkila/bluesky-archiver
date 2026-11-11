// Feature: feature/delete-old-likes.feature
// Cycles 2-3: list every like across all pages; fail loudly when a request fails.
import { expect, test } from "vitest";
import { listRecords } from "../src/bluesky";
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

  const records = await listRecords({
    collection: "app.bsky.feed.like",
    baseUrl: BASE_URL,
    did: DID,
    fetch: bluesky.fetch,
  });

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

  const records = await listRecords({
    collection: "app.bsky.feed.like",
    baseUrl: BASE_URL,
    did: DID,
    fetch: bluesky.fetch,
  });

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
    listRecords({
      collection: "app.bsky.feed.like",
      baseUrl: BASE_URL,
      did: OTHER_DID,
      fetch: bluesky.fetch,
    }),
  ).rejects.toThrow(/com\.atproto\.repo\.listRecords.*400/);
});

test("fails loudly naming the request when the server answers a page with an error", async () => {
  const { bluesky } = blueskyWithLikes(250);
  bluesky.failPage({ cursor: "100", status: 500 });

  await expect(
    listRecords({
      collection: "app.bsky.feed.like",
      baseUrl: BASE_URL,
      did: DID,
      fetch: bluesky.fetch,
    }),
  ).rejects.toThrow(/com\.atproto\.repo\.listRecords.*500/);
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

test("an empty page ends paging even when it carries a cursor", async () => {
  const listed = Array.from({ length: 3 }, (_, index) => ({ uri: `at://${DID}/like/${index}` }));
  const pages = [
    { records: listed, cursor: "c1" },
    { records: [], cursor: "c2" },
    { records: [{ uri: `at://${DID}/like/beyond-the-empty-page` }] },
  ];
  const requested: URL[] = [];
  const serveNextPage = async (input: URL | string) => {
    requested.push(new URL(input));
    return Response.json(pages[requested.length - 1]);
  };

  const records = await listRecords({
    baseUrl: BASE_URL,
    did: DID,
    collection: "app.bsky.feed.like",
    fetch: serveNextPage,
  });

  expect(records.map((record) => record.uri)).toStrictEqual(listed.map((record) => record.uri));
  expect(requested.map((url) => url.searchParams.get("cursor"))).toStrictEqual([null, "c1"]);
});

/** An error body that stays open until cancelled; `cancelled` records each cancel. */
function openErrorResponse(status: number, cancelled: unknown[]): Response {
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("{}"));
    },
    cancel(reason) {
      cancelled.push(reason);
    },
  });
  return new Response(body, { status });
}

test("cancels the unread body of a failed page before rejecting", async () => {
  const cancelled: unknown[] = [];
  const serverError = async () => openErrorResponse(500, cancelled);

  await expect(
    listRecords({
      collection: "app.bsky.feed.like",
      baseUrl: BASE_URL,
      did: DID,
      fetch: serverError,
    }),
  ).rejects.toThrow(/com\.atproto\.repo\.listRecords.*500/);
  expect(cancelled).toHaveLength(1);
});
