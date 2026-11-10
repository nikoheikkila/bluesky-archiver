import { expectTypeOf, test } from "vitest";
import { deleteRecords } from "../src/delete";

interface PostRecord {
  uri: string;
  cid: string;
  value: { $type: "app.bsky.feed.post"; text: string; createdAt: string };
}

test("deleteRecords is callable with the posts collection and post records", () => {
  expectTypeOf(deleteRecords).toBeCallableWith("app.bsky.feed.post", [] as PostRecord[], {
    did: "did:plc:alice",
    fetchHandler: async () => new Response(),
    onBatchDeleted: (_batch: PostRecord[]) => {},
  });
});
