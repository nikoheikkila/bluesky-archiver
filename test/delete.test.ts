// Feature: feature/delete-old-likes.feature
// Cycle 3: delete likes in batches.
import { afterEach, expect, test, vi } from "vitest";
import type { Collection, LikeRecord, RepostRecord, SubjectRecord } from "../src/bluesky";
import { deleteLikes, deleteRecords } from "../src/delete";
import { login } from "../src/session";
import { createFakeBluesky } from "./fake-bluesky";

const DID = "did:plc:fakeaccount000000000000";
const BASE_URL = "https://fake-bluesky.test";
const APP_PASSWORD = "fake-app-password";
const APPLY_WRITES = "/xrpc/com.atproto.repo.applyWrites";
const CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";

afterEach(() => {
  vi.restoreAllMocks();
});

interface Write {
  $type: string;
  collection: string;
  rkey: string;
}

const rkeyOf = (record: SubjectRecord) => record.uri.split("/").at(-1);

const LIKES = "app.bsky.feed.like";
const REPOSTS = "app.bsky.feed.repost";

const batchingRows = (collection: Collection, plural: string) => [
  {
    name: `450 ${plural} are deleted in batches of 200, 200 and 50`,
    collection,
    total: 450,
    failSecondBatch: false,
    sentSizes: [200, 200, 50],
    reportedSizes: [200, 200, 50],
    remaining: 0,
  },
  {
    name: `a failing second batch rejects after the first batch and leaves 250 ${plural}`,
    collection,
    total: 450,
    failSecondBatch: true,
    sentSizes: [200, 200],
    reportedSizes: [200],
    remaining: 250,
  },
];

test.each([...batchingRows(LIKES, "likes"), ...batchingRows(REPOSTS, "reposts")])(
  "$name ($collection)",
  async ({ collection, total, failSecondBatch, sentSizes, reportedSizes, remaining }) => {
    const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
    bluesky.intercept();
    const seed = (index: number) => ({
      subject: `at://${DID}/app.bsky.feed.post/${index}`,
      createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
    });
    const likes: SubjectRecord[] = Array.from({ length: total }, (_, index) => {
      if (collection === REPOSTS) {
        const repost = bluesky.addRepost(seed(index));
        return {
          uri: repost.uri,
          cid: CID,
          value: {
            $type: REPOSTS,
            subject: { uri: repost.subject, cid: CID },
            createdAt: repost.createdAt,
          },
        } satisfies RepostRecord;
      }
      const like = bluesky.addLike(seed(index));
      return {
        uri: like.uri,
        cid: CID,
        value: {
          $type: LIKES,
          subject: { uri: like.subject, cid: CID },
          createdAt: like.createdAt,
        },
      } satisfies LikeRecord;
    });
    const stored = () => (collection === REPOSTS ? bluesky.reposts() : bluesky.likes());
    if (failSecondBatch) {
      bluesky.failApplyWrites({ call: 2, status: 500 });
    }
    const session = await login({ baseUrl: BASE_URL, did: DID, password: APP_PASSWORD });
    const sentBodies: { writes: Write[] }[] = [];
    const fetchHandler: typeof session.fetchHandler = (path, init) => {
      if (path === APPLY_WRITES) {
        sentBodies.push(JSON.parse(String(init?.body)));
      }
      return session.fetchHandler(path, init);
    };
    const reported: SubjectRecord[][] = [];

    const failure = await deleteRecords(collection, likes, {
      did: DID,
      fetchHandler,
      onBatchDeleted: (batch) => reported.push(batch),
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    const writePaths = bluesky
      .requests()
      .filter(({ method, url }) => method === "POST" && new URL(url).pathname === APPLY_WRITES);
    expect(writePaths).toHaveLength(sentBodies.length);
    expect(sentBodies.map(({ writes }) => writes.length)).toStrictEqual(sentSizes);
    const sentWrites = sentBodies.flatMap(({ writes }) => writes);
    expect(
      sentWrites.every(
        (write) =>
          write.$type === "com.atproto.repo.applyWrites#delete" && write.collection === collection,
      ),
    ).toBe(true);
    expect(sentWrites.map((write) => write.rkey)).toStrictEqual(
      likes.slice(0, sentWrites.length).map(rkeyOf),
    );
    expect(reported.map((batch) => batch.length)).toStrictEqual(reportedSizes);
    expect(reported.flat()).toStrictEqual(likes.slice(0, reported.flat().length));
    expect(stored()).toHaveLength(remaining);
    expect(stored().map(({ uri }) => uri)).toStrictEqual(
      likes.slice(total - remaining).map(({ uri }) => uri),
    );
    if (failSecondBatch) {
      expect(failure, "a failed batch rejects").toBeInstanceOf(Error);
      expect(failure?.message).toContain("500");
    } else {
      expect(failure).toBeUndefined();
    }
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
  const responses: Response[] = [];
  const fetchHandler = async () => {
    const response =
      responses.length === 0
        ? new Response(JSON.stringify({ results: [] }), { status: 200 })
        : new Response(JSON.stringify({ error: "InternalServerError" }), { status: 500 });
    responses.push(response);
    return response;
  };

  await deleteLikes(likes, { did: DID, fetchHandler, onBatchDeleted: () => {} }).catch(
    () => undefined,
  );

  expect(responses.map((response) => response.status)).toStrictEqual([200, 500]);
  expect(
    responses.map((response) => response.bodyUsed),
    "every applyWrites response body is consumed or cancelled",
  ).toStrictEqual([true, true]);
});
