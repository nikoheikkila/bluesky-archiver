import { expectTypeOf, test } from "vitest";
import type { LikeRecord } from "../src/bluesky";
import { listLikes, listRecords } from "../src/bluesky";
import type { Selection } from "../src/select";
import { selectOldLikes, selectOldRecords } from "../src/select";

test("listRecords for the likes collection resolves to like records", () => {
  expectTypeOf(listRecords<"app.bsky.feed.like">).returns.toEqualTypeOf<Promise<LikeRecord[]>>();
});

test("listLikes resolves to like records", () => {
  expectTypeOf(listLikes).returns.toEqualTypeOf<Promise<LikeRecord[]>>();
});

test("selectOldRecords over likes returns a selection of like records", () => {
  expectTypeOf(selectOldRecords<LikeRecord>).returns.toEqualTypeOf<Selection<LikeRecord>>();
});

test("selectOldLikes returns a selection of like records", () => {
  expectTypeOf(selectOldLikes).returns.toEqualTypeOf<Selection<LikeRecord>>();
});
