import type { LikeRecord } from "./bluesky";

/** applyWrites accepts at most 200 writes per call. */
const MAX_WRITES_PER_BATCH = 200;

export interface DeleteLikesOptions {
  did: string;
  fetchHandler: (path: string, init?: RequestInit) => Promise<Response>;
  onBatchDeleted: (batch: LikeRecord[]) => void;
}

export async function deleteLikes(likes: LikeRecord[], options: DeleteLikesOptions): Promise<void> {
  for (let start = 0; start < likes.length; start += MAX_WRITES_PER_BATCH) {
    const batch = likes.slice(start, start + MAX_WRITES_PER_BATCH);
    await applyDeletes(batch, options);
    options.onBatchDeleted(batch);
  }
}

async function applyDeletes(
  batch: LikeRecord[],
  { did, fetchHandler }: DeleteLikesOptions,
): Promise<void> {
  const writes = batch.map((like) => ({
    $type: "com.atproto.repo.applyWrites#delete",
    collection: "app.bsky.feed.like",
    rkey: like.uri.split("/").pop(),
  }));
  const response = await fetchHandler("/xrpc/com.atproto.repo.applyWrites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: did, writes }),
  });
  // The body is never read; cancel it so the Workers runtime releases the connection.
  await response.body?.cancel();
  if (!response.ok) {
    throw new Error(`applyWrites failed with HTTP ${response.status}`);
  }
}
