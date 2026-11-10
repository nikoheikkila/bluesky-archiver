import { expectTypeOf, test } from "vitest";
import type { LikeRecord } from "../src/bluesky";
import { listLikes, listRecords } from "../src/bluesky";
import { deleteRecords } from "../src/delete";
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

interface PostRecord {
  uri: string;
  cid: string;
  value: { $type: "app.bsky.feed.post"; text: string; createdAt: string };
}

test("selectOldRecords is callable with post records and a run start", () => {
  expectTypeOf(selectOldRecords).toBeCallableWith([] as PostRecord[], 0);
});

test("deleteRecords is callable with the posts collection and post records", () => {
  expectTypeOf(deleteRecords).toBeCallableWith("app.bsky.feed.post", [] as PostRecord[], {
    did: "did:plc:alice",
    fetchHandler: async () => new Response(),
    onBatchDeleted: (_batch: PostRecord[]) => {},
  });
});

test("listRecords for the reply settings collection resolves to threadgate records", () => {
  type Listed = Awaited<ReturnType<typeof listRecords<"app.bsky.feed.threadgate">>>[number];

  expectTypeOf<Listed["value"]["$type"]>().toEqualTypeOf<"app.bsky.feed.threadgate">();
});
