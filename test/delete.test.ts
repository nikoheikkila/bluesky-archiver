// Feature: feature/delete-old-likes.feature
// Cycle 3: delete likes in batches.
import { expect, test } from "vitest";
import { deleteRecords } from "../src/delete";
import type {
  DatedRecordOf,
  LikeRecord,
  SubjectRecord,
  SubjectRecordOf,
} from "../src/domain-types";
import { login } from "../src/session";
import { APP_PASSWORD, BASE_URL, CID, DID } from "./constants";
import { createFakeBluesky, type NewLike } from "./fake-bluesky";
import { deletesOf } from "./network";

const LIKE = "app.bsky.feed.like";

const KINDS = [
  { kind: "likes", collection: LIKE, add: "addLikes", stored: "likes" },
  { kind: "reposts", collection: "app.bsky.feed.repost", add: "addReposts", stored: "reposts" },
] as const;

const seed = (index: number): NewLike => ({
  subject: `at://${DID}/app.bsky.feed.post/${index}`,
  createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
});

const seeds = (count: number) => Array.from({ length: count }, (_, index) => seed(index));

// The record as listRecords serves it.
const subjectRecord = <C extends string>(
  collection: C,
  { uri, subject, createdAt }: { uri: string; subject: string; createdAt: string },
): SubjectRecordOf<C> => ({
  uri,
  cid: CID,
  value: { $type: collection, subject: { uri: subject, cid: CID }, createdAt },
});

const likeAt = (uri: string, index = 0): LikeRecord => subjectRecord(LIKE, { uri, ...seed(index) });

const likes = (count: number) =>
  seeds(count).map((_, index) => likeAt(`at://${DID}/${LIKE}/${index}`, index));

async function deletionOf({ collection, add, stored }: (typeof KINDS)[number], count = 450) {
  const bluesky = createFakeBluesky({ appPassword: APP_PASSWORD });
  const records = bluesky[add](seeds(count)).map(
    (stored) => subjectRecord(collection, stored) as SubjectRecord,
  );
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
  expect(bluesky.receivedWrites().flat()).toStrictEqual(deletesOf(kind.collection, records));
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
      deletesOf(kind.collection, records.slice(0, 400)),
    );
    expect(reported).toStrictEqual([records.slice(0, 200)]);
    expect(stored().map(({ uri }) => uri)).toStrictEqual(records.slice(200).map(({ uri }) => uri));
  },
);

test("consumes or cancels every applyWrites response body, on success and on failure", async () => {
  const responses = [
    new Response(JSON.stringify({ results: [] }), { status: 200 }),
    new Response(JSON.stringify({ error: "InternalServerError" }), { status: 500 }),
  ];
  let calls = 0;
  const fetchHandler = async () => responses[calls++];

  await expect(
    deleteRecords(LIKE, likes(450), {
      did: DID,
      fetchHandler,
      onBatchDeleted: () => {},
    }),
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

const oneLike = () => likeAt(`at://${DID}/${LIKE}/one`);

test("sends applyWrites as JSON", async () => {
  const inits: (RequestInit | undefined)[] = [];
  const fetchHandler = async (_path: string, init?: RequestInit) => {
    inits.push(init);
    return Response.json({ results: [] });
  };

  await deleteRecords(LIKE, [oneLike()], {
    did: DID,
    fetchHandler,
    onBatchDeleted: () => {},
  });

  expect(inits.map((init) => new Headers(init?.headers).get("content-type"))).toStrictEqual([
    "application/json",
  ]);
});

test("accepts an applyWrites response without a body", async () => {
  const reported: LikeRecord[][] = [];
  const answerWithoutBody = async () => new Response(null, { status: 200 });

  await expect(
    deleteRecords(LIKE, [oneLike()], {
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
  const bluesky = createFakeBluesky({ appPassword: APP_PASSWORD });
  const posts = seeds(450).map(({ createdAt }, index) =>
    bluesky.addAccountPost({ kind: "plain", text: `post ${index}`, createdAt }),
  );
  const records: DatedRecordOf<"app.bsky.feed.post">[] = posts.map(({ uri, createdAt }) => ({
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
  expect(bluesky.receivedWrites().flat()).toStrictEqual(deletesOf("app.bsky.feed.post", records));
  expect(bluesky.accountPosts()).toStrictEqual([]);
});

test.each([
  { reason: "a foreign DID", uri: "at://did:plc:otheraccount222222222222/app.bsky.feed.like/x" },
  { reason: "another collection", uri: `at://${DID}/app.bsky.feed.repost/x` },
  { reason: "no at:// prefix", uri: "https://example.com/x" },
  { reason: "an empty rkey", uri: `at://${DID}/${LIKE}/` },
  { reason: "extra path segments", uri: `at://${DID}/${LIKE}/a/b` },
])("refuses a record URI with $reason before sending any request", async ({ uri }) => {
  const paths: string[] = [];
  const reported: LikeRecord[][] = [];
  const fetchHandler = async (path: string) => {
    paths.push(path);
    return Response.json({ results: [] });
  };

  await expect(
    deleteRecords(LIKE, [...likes(450), likeAt(uri, 450)], {
      did: DID,
      fetchHandler,
      onBatchDeleted: (batch) => {
        reported.push(batch);
      },
    }),
  ).rejects.toThrow(uri);

  expect(paths).toStrictEqual([]);
  expect(reported).toStrictEqual([]);
});
