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

test("DatedRecordOf for the posts collection has no subject", () => {
  expectTypeOf<DatedRecordOf<"app.bsky.feed.post">["value"]>().toEqualTypeOf<{
    $type: "app.bsky.feed.post";
    createdAt: string;
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
