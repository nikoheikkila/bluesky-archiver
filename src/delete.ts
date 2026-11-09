import { type Collection, LIKE_COLLECTION, type LikeRecord, type SubjectRecord } from "./bluesky";

/** applyWrites accepts at most 200 writes per call. */
const MAX_WRITES_PER_BATCH = 200;

export interface DeleteRecordsOptions<T extends SubjectRecord> {
  did: string;
  fetchHandler: (path: string, init?: RequestInit) => Promise<Response>;
  onBatchDeleted: (batch: T[]) => void;
}

export type DeleteLikesOptions = DeleteRecordsOptions<LikeRecord>;

export function deleteLikes(likes: LikeRecord[], options: DeleteLikesOptions): Promise<void> {
  return deleteRecords(LIKE_COLLECTION, likes, options);
}

export async function deleteRecords<T extends SubjectRecord>(
  collection: Collection,
  records: T[],
  options: DeleteRecordsOptions<T>,
): Promise<void> {
  for (let start = 0; start < records.length; start += MAX_WRITES_PER_BATCH) {
    const batch = records.slice(start, start + MAX_WRITES_PER_BATCH);
    await applyDeletes(collection, batch, options);
    options.onBatchDeleted(batch);
  }
}

async function applyDeletes<T extends SubjectRecord>(
  collection: Collection,
  batch: T[],
  { did, fetchHandler }: DeleteRecordsOptions<T>,
): Promise<void> {
  const writes = batch.map((record) => ({
    $type: "com.atproto.repo.applyWrites#delete",
    collection,
    rkey: record.uri.split("/").pop(),
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
