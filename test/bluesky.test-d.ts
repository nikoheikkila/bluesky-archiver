import { expectTypeOf, test } from "vitest";
import { type ListRecordsOptions, listRecords } from "../src/bluesky";
import type { LikeRecord } from "../src/domain-types";

test("listRecords for the likes collection resolves to like records", () => {
  expectTypeOf(listRecords<"app.bsky.feed.like">).returns.toEqualTypeOf<Promise<LikeRecord[]>>();
});

test("listRecords for the reply settings collection resolves to threadgate records", () => {
  type Listed = Awaited<ReturnType<typeof listRecords<"app.bsky.feed.threadgate">>>[number];

  expectTypeOf<Listed["value"]["$type"]>().toEqualTypeOf<"app.bsky.feed.threadgate">();
});

test("listRecords for the likes collection takes likes listing options", () => {
  expectTypeOf(listRecords<"app.bsky.feed.like">)
    .parameter(0)
    .toEqualTypeOf<ListRecordsOptions<"app.bsky.feed.like">>();
});

test("listRecords for the reply settings collection takes reply settings listing options", () => {
  expectTypeOf(listRecords<"app.bsky.feed.threadgate">)
    .parameter(0)
    .toEqualTypeOf<ListRecordsOptions<"app.bsky.feed.threadgate">>();
});
