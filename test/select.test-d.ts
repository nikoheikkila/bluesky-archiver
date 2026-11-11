import { expectTypeOf, test } from "vitest";
import type { DatedRecordOf, LikeRecord } from "../src/domain-types";
import type { Selection } from "../src/select";
import { selectOldRecords } from "../src/select";

test("selectOldRecords over likes returns a selection of like records", () => {
  expectTypeOf(selectOldRecords<LikeRecord>).returns.toEqualTypeOf<Selection<LikeRecord>>();
});

test("selectOldRecords is callable with post records and a run start", () => {
  expectTypeOf(selectOldRecords).toBeCallableWith([] as DatedRecordOf<"app.bsky.feed.post">[], 0);
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
