import { expectTypeOf, test } from "vitest";
import type {
  Collection,
  DatedRecord,
  DatedRecordOf,
  LikeRecord,
  RecordIn,
  RepostRecord,
  SubjectRecord,
} from "../src/domain-types";

test("LikeRecord value carries the like type, a subject and a creation time", () => {
  expectTypeOf<LikeRecord["value"]>().toEqualTypeOf<{
    $type: "app.bsky.feed.like";
    subject: { uri: string; cid: string };
    createdAt: string;
  }>();
});

test("RepostRecord value carries the repost type, a subject and a creation time", () => {
  expectTypeOf<RepostRecord["value"]>().toEqualTypeOf<{
    $type: "app.bsky.feed.repost";
    subject: { uri: string; cid: string };
    createdAt: string;
  }>();
});

test("SubjectRecord is a like record or a repost record", () => {
  expectTypeOf<SubjectRecord>().toEqualTypeOf<LikeRecord | RepostRecord>();
});

test("DatedRecordOf for the posts collection has no subject and an optional creation time", () => {
  expectTypeOf<DatedRecordOf<"app.bsky.feed.post">["value"]>().toEqualTypeOf<{
    $type: "app.bsky.feed.post";
    createdAt?: string;
  }>();
});

test("DatedRecord value has any type and an optional creation time", () => {
  expectTypeOf<DatedRecord["value"]>().toEqualTypeOf<{
    $type: string;
    createdAt?: string;
  }>();
});

test("DatedRecord accepts any string as its type", () => {
  expectTypeOf<DatedRecord["value"]["$type"]>().toEqualTypeOf<string>();
});

test("Collection names the five collections", () => {
  expectTypeOf<Collection>().toEqualTypeOf<
    | "app.bsky.feed.like"
    | "app.bsky.feed.repost"
    | "app.bsky.feed.post"
    | "app.bsky.feed.threadgate"
    | "app.bsky.feed.postgate"
  >();
});

test("RecordIn the likes collection is a like record", () => {
  expectTypeOf<RecordIn<"app.bsky.feed.like">>().toEqualTypeOf<LikeRecord>();
});

test("RecordIn the posts collection is a dated post record", () => {
  expectTypeOf<RecordIn<"app.bsky.feed.post">>().toEqualTypeOf<
    DatedRecordOf<"app.bsky.feed.post">
  >();
});

test("RecordIn every collection is each collection's own record type", () => {
  expectTypeOf<RecordIn<Collection>>().toEqualTypeOf<
    | LikeRecord
    | RepostRecord
    | DatedRecordOf<"app.bsky.feed.post">
    | DatedRecordOf<"app.bsky.feed.threadgate">
    | DatedRecordOf<"app.bsky.feed.postgate">
  >();
});

test("RecordIn the reply settings collection is a dated threadgate record", () => {
  expectTypeOf<RecordIn<"app.bsky.feed.threadgate">>().toEqualTypeOf<
    DatedRecordOf<"app.bsky.feed.threadgate">
  >();
});

test("RecordIn the quote settings collection is a dated postgate record", () => {
  expectTypeOf<RecordIn<"app.bsky.feed.postgate">>().toEqualTypeOf<
    DatedRecordOf<"app.bsky.feed.postgate">
  >();
});

test("RecordIn the reposts collection is a repost record", () => {
  expectTypeOf<RecordIn<"app.bsky.feed.repost">>().toEqualTypeOf<RepostRecord>();
});

test("RecordIn the posts collection is not a subject record", () => {
  expectTypeOf<RecordIn<"app.bsky.feed.post">>().not.toEqualTypeOf<SubjectRecord>();
});
