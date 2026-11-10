import { LIKE_COLLECTION } from "./bluesky";
import type { Collection, DatedRecord, LikeRecord, RecordIn } from "./domain-types";

/** applyWrites accepts at most 200 writes per call. */
const MAX_WRITES_PER_BATCH = 200;

export interface DeleteRecordsOptions<T extends DatedRecord> {
  did: string;
  fetchHandler: (path: string, init?: RequestInit) => Promise<Response>;
  onBatchDeleted(batch: T[]): void;
}

export type DeleteLikesOptions = DeleteRecordsOptions<LikeRecord>;

export function deleteLikes(likes: LikeRecord[], options: DeleteLikesOptions): Promise<void> {
  return deleteRecords(LIKE_COLLECTION, likes, options);
}

export async function deleteRecords<C extends Collection>(
  collection: C,
  records: RecordIn<C>[],
  options: DeleteRecordsOptions<RecordIn<C>>,
): Promise<void> {
  const prefix = `at://${options.did}/${collection}/`;
  for (const record of records) {
    const rkey = record.uri.startsWith(prefix) ? record.uri.slice(prefix.length) : "";
    if (rkey === "" || rkey.includes("/")) {
      throw new Error(`refusing to delete record with unexpected URI ${record.uri}`);
    }
  }
  for (let start = 0; start < records.length; start += MAX_WRITES_PER_BATCH) {
    const batch = records.slice(start, start + MAX_WRITES_PER_BATCH);
    await applyDeletes(collection, batch, options);
    options.onBatchDeleted(batch);
  }
}

async function applyDeletes<T extends DatedRecord>(
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
