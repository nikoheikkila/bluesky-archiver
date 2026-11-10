// Feature: feature/delete-old-likes.feature
// Cycle 3: delete likes in batches.
import { expect, test } from "vitest";
import { deleteLikes, deleteRecords } from "../src/delete";
import type { Collection, DatedRecord, LikeRecord, SubjectRecord } from "../src/domain-types";
import { login } from "../src/session";
import { createFakeBluesky, type NewLike } from "./fake-bluesky";

const DID = "did:plc:fakeaccount000000000000";
const BASE_URL = "https://fake-bluesky.test";
const APP_PASSWORD = "fake-app-password";
const CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
const DELETE = "com.atproto.repo.applyWrites#delete";

const KINDS = [
  { kind: "likes", collection: "app.bsky.feed.like", add: "addLikes", stored: "likes" },
  { kind: "reposts", collection: "app.bsky.feed.repost", add: "addReposts", stored: "reposts" },
] as const;

const rkeyOf = (record: { uri: string }) => record.uri.split("/").at(-1);

const seeds = (count: number): NewLike[] =>
  Array.from({ length: count }, (_, index) => ({
    subject: `at://${DID}/app.bsky.feed.post/${index}`,
    createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
  }));

// The record as listRecords serves it, built from what the fake stored.
const toSubjectRecord =
  (collection: Collection) =>
  (stored: { uri: string; subject: string; createdAt: string }): SubjectRecord =>
    ({
      uri: stored.uri,
      cid: CID,
      value: {
        $type: collection,
        subject: { uri: stored.subject, cid: CID },
        createdAt: stored.createdAt,
      },
    }) as SubjectRecord;

async function deletionOf({ collection, add, stored }: (typeof KINDS)[number], count = 450) {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
  const records = bluesky[add](seeds(count)).map(toSubjectRecord(collection));
  const session = await login({
    baseUrl: BASE_URL,
    did: DID,
    password: APP_PASSWORD,
    fetch: bluesky.fetch,
  });
  const reported: SubjectRecord[][] = [];
  const run = () =>
    deleteRecords(collection, records, {
      did: DID,
      fetchHandler: session.fetchHandler,
      onBatchDeleted: (batch) => {
        reported.push(batch);
      },
    });
  return { bluesky, records, reported, run, stored: () => bluesky[stored]() };
}

test.each(KINDS)("deletes 450 $kind in batches of 200, 200 and 50", async (kind) => {
  const { bluesky, records, reported, run, stored } = await deletionOf(kind);

  await expect(run()).resolves.toBeUndefined();

  expect(bluesky.receivedWrites().map((writes) => writes.length)).toStrictEqual([200, 200, 50]);
  expect(bluesky.receivedWrites().flat()).toStrictEqual(
    records.map((record) => ({ $type: DELETE, collection: kind.collection, rkey: rkeyOf(record) })),
  );
  expect(reported.map((batch) => batch.length)).toStrictEqual([200, 200, 50]);
  expect(reported.flat()).toStrictEqual(records);
  expect(stored()).toStrictEqual([]);
});

test.each(KINDS)(
  "rejects after the first batch when the second fails, leaving 250 $kind",
  async (kind) => {
    const { bluesky, records, reported, run, stored } = await deletionOf(kind);
    bluesky.failApplyWrites({ call: 2, status: 500 });

    await expect(run()).rejects.toThrow("500");

    expect(bluesky.receivedWrites().map((writes) => writes.length)).toStrictEqual([200, 200]);
    expect(bluesky.receivedWrites().flat()).toStrictEqual(
      records
        .slice(0, 400)
        .map((record) => ({ $type: DELETE, collection: kind.collection, rkey: rkeyOf(record) })),
    );
    expect(reported).toStrictEqual([records.slice(0, 200)]);
    expect(stored().map(({ uri }) => uri)).toStrictEqual(records.slice(200).map(({ uri }) => uri));
  },
);

test("consumes or cancels every applyWrites response body, on success and on failure", async () => {
  const likes: LikeRecord[] = Array.from({ length: 450 }, (_, index) => {
    const uri = `at://${DID}/app.bsky.feed.like/${index}`;
    const createdAt = new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString();
    return {
      uri,
      cid: CID,
      value: {
        $type: "app.bsky.feed.like",
        subject: { uri: `at://${DID}/app.bsky.feed.post/${index}`, cid: CID },
        createdAt,
      },
    };
  });
  const responses = [
    new Response(JSON.stringify({ results: [] }), { status: 200 }),
    new Response(JSON.stringify({ error: "InternalServerError" }), { status: 500 }),
  ];
  let calls = 0;
  const fetchHandler = async () => responses[calls++];

  await expect(
    deleteLikes(likes, { did: DID, fetchHandler, onBatchDeleted: () => {} }),
  ).rejects.toThrow("500");

  expect(
    responses.map((response) => response.bodyUsed),
    "every applyWrites response body is consumed or cancelled",
  ).toStrictEqual([true, true]);
});

test.each([
  { count: 0, batches: [] },
  { count: 200, batches: [200] },
  { count: 400, batches: [200, 200] },
])(
  "deletes $count likes in $batches.length full batches, never an empty one",
  async ({ count, batches }) => {
    const { bluesky, reported, run, stored } = await deletionOf(KINDS[0], count);

    await run();

    expect(bluesky.receivedWrites().map((writes) => writes.length)).toStrictEqual(batches);
    expect(reported.map((batch) => batch.length)).toStrictEqual(batches);
    expect(stored()).toStrictEqual([]);
  },
);

const oneLike = (): LikeRecord => ({
  uri: `at://${DID}/app.bsky.feed.like/one`,
  cid: CID,
  value: {
    $type: "app.bsky.feed.like",
    subject: { uri: `at://${DID}/app.bsky.feed.post/one`, cid: CID },
    createdAt: "2020-01-01T00:00:00.000Z",
  },
});

test("sends applyWrites as JSON", async () => {
  const inits: (RequestInit | undefined)[] = [];
  const fetchHandler = async (_path: string, init?: RequestInit) => {
    inits.push(init);
    return Response.json({ results: [] });
  };

  await deleteLikes([oneLike()], { did: DID, fetchHandler, onBatchDeleted: () => {} });

  expect(inits.map((init) => new Headers(init?.headers).get("content-type"))).toStrictEqual([
    "application/json",
  ]);
});

test("accepts an applyWrites response without a body", async () => {
  const reported: LikeRecord[][] = [];
  const answerWithoutBody = async () => new Response(null, { status: 200 });

  await expect(
    deleteLikes([oneLike()], {
      did: DID,
      fetchHandler: answerWithoutBody,
      onBatchDeleted: (batch) => {
        reported.push(batch);
      },
    }),
  ).resolves.toBeUndefined();

  expect(reported).toStrictEqual([[oneLike()]]);
});

test("deletes 450 posts in batches of 200, 200 and 50, all in the post collection", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
  const posts = seeds(450).map(({ createdAt }, index) =>
    bluesky.addAccountPost({ kind: "plain", text: `post ${index}`, createdAt }),
  );
  const records: DatedRecord[] = posts.map(({ uri, createdAt }) => ({
    uri,
    cid: CID,
    value: { $type: "app.bsky.feed.post", createdAt },
  }));
  const session = await login({
    baseUrl: BASE_URL,
    did: DID,
    password: APP_PASSWORD,
    fetch: bluesky.fetch,
  });

  await deleteRecords("app.bsky.feed.post", records, {
    did: DID,
    fetchHandler: session.fetchHandler,
    onBatchDeleted: () => {},
  });

  expect(bluesky.receivedWrites().map((writes) => writes.length)).toStrictEqual([200, 200, 50]);
  expect(
    bluesky
      .receivedWrites()
      .flat()
      .map((write) => write.collection),
  ).toStrictEqual(Array(450).fill("app.bsky.feed.post"));
  expect(
    bluesky
      .receivedWrites()
      .flat()
      .map((write) => write.rkey),
  ).toStrictEqual(records.map(rkeyOf));
  expect(bluesky.accountPosts()).toStrictEqual([]);
});
