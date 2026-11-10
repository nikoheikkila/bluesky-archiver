import { expectTypeOf, test } from "vitest";
import { type DeleteRecordsOptions, deleteRecords } from "../src/delete";
import type { DatedRecordOf, LikeRecord } from "../src/domain-types";

type PostRecord = DatedRecordOf<"app.bsky.feed.post">;

test("deleteRecords is callable with the posts collection and post records", () => {
  expectTypeOf(deleteRecords).toBeCallableWith("app.bsky.feed.post", [] as PostRecord[], {
    did: "did:plc:alice",
    fetchHandler: async () => new Response(),
    onBatchDeleted: (_batch: PostRecord[]) => {},
  });
});

test("deleteRecords for posts takes the posts collection as its first parameter", () => {
  expectTypeOf(deleteRecords<"app.bsky.feed.post">)
    .parameter(0)
    .toEqualTypeOf<"app.bsky.feed.post">();
});

test("deleteRecords for posts takes post records as its second parameter", () => {
  expectTypeOf(deleteRecords<"app.bsky.feed.post">)
    .parameter(1)
    .toEqualTypeOf<PostRecord[]>();
});

test("deleteRecords for posts takes post options as its third parameter", () => {
  expectTypeOf(deleteRecords<"app.bsky.feed.post">)
    .parameter(2)
    .toEqualTypeOf<DeleteRecordsOptions<PostRecord>>();
});

test("deleteRecords for likes takes like records as its second parameter", () => {
  expectTypeOf(deleteRecords<"app.bsky.feed.like">)
    .parameter(1)
    .toEqualTypeOf<LikeRecord[]>();
});

const fetchHandler = async () => new Response();

test("deleteRecords for likes is not callable with post records", () => {
  const refuseLikeCollectionWithPosts = () =>
    deleteRecords(
      "app.bsky.feed.like",
      // @ts-expect-error post records are not like records
      [] as PostRecord[],
      { did: "did:plc:alice", fetchHandler, onBatchDeleted: (_batch: LikeRecord[]) => {} },
    );

  expectTypeOf(refuseLikeCollectionWithPosts).toBeFunction();
});

test("deleteRecords for posts is not callable with like records", () => {
  const refusePostCollectionWithLikes = () =>
    deleteRecords(
      "app.bsky.feed.post",
      // @ts-expect-error like records are not post records
      [] as LikeRecord[],
      { did: "did:plc:alice", fetchHandler, onBatchDeleted: (_batch: PostRecord[]) => {} },
    );

  expectTypeOf(refusePostCollectionWithLikes).toBeFunction();
});
