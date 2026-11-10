import { expectTypeOf, test } from "vitest";
import type { LikeRecord } from "../src/domain-types";
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
