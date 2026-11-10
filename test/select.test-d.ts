import { expectTypeOf, test } from "vitest";
import type { DatedRecordOf, LikeRecord } from "../src/domain-types";
import type { Selection } from "../src/select";
import { selectOldLikes, selectOldRecords } from "../src/select";

test("selectOldRecords over likes returns a selection of like records", () => {
  expectTypeOf(selectOldRecords<LikeRecord>).returns.toEqualTypeOf<Selection<LikeRecord>>();
});

test("selectOldLikes returns a selection of like records", () => {
  expectTypeOf(selectOldLikes).returns.toEqualTypeOf<Selection<LikeRecord>>();
});

interface PostRecord {
  uri: string;
  cid: string;
  value: { $type: "app.bsky.feed.post"; text: string; createdAt: string };
}

test("selectOldRecords is callable with post records and a run start", () => {
  expectTypeOf(selectOldRecords).toBeCallableWith([] as PostRecord[], 0);
});

test("selectOldRecords over likes takes like records and a run start", () => {
  expectTypeOf(selectOldRecords<LikeRecord>)
    .parameter(0)
    .toEqualTypeOf<LikeRecord[]>();
  expectTypeOf(selectOldRecords<LikeRecord>)
    .parameter(1)
    .toEqualTypeOf<number>();
});

test("selectOldRecords over posts takes post records and a run start", () => {
  expectTypeOf(selectOldRecords<DatedRecordOf<"app.bsky.feed.post">>)
    .parameter(0)
    .toEqualTypeOf<DatedRecordOf<"app.bsky.feed.post">[]>();
  expectTypeOf(selectOldRecords<DatedRecordOf<"app.bsky.feed.post">>)
    .parameter(1)
    .toEqualTypeOf<number>();
});

test("selectOldLikes takes like records and a run start", () => {
  expectTypeOf(selectOldLikes).parameter(0).toEqualTypeOf<LikeRecord[]>();
  expectTypeOf(selectOldLikes).parameter(1).toEqualTypeOf<number>();
});
