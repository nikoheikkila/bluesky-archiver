import type { Collection, RecordIn } from "./domain-types";
import type { AuthorisedSession } from "./session";

/** applyWrites accepts at most 200 writes per call. */
const MAX_WRITES_PER_BATCH = 200;

export interface DeleteRecordsOptions<T> {
  did: string;
  fetchHandler: AuthorisedSession["fetchHandler"];
  onBatchDeleted(batch: T[]): void;
}

export async function deleteRecords<C extends Collection>(
  collection: C,
  records: RecordIn<C>[],
  { did, fetchHandler, onBatchDeleted }: DeleteRecordsOptions<RecordIn<C>>,
): Promise<void> {
  const prefix = `at://${did}/${collection}/`;
  // Every URI is checked before the first request, so a bad one sends nothing.
  const rkeys = records.map(({ uri }) => {
    const rkey = uri.startsWith(prefix) ? uri.slice(prefix.length) : "";
    if (rkey === "" || rkey.includes("/")) {
      throw new Error(`refusing to delete record with unexpected URI ${uri}`);
    }
    return rkey;
  });
  for (let start = 0; start < records.length; start += MAX_WRITES_PER_BATCH) {
    const end = start + MAX_WRITES_PER_BATCH;
    const writes = rkeys
      .slice(start, end)
      .map((rkey) => ({ $type: "com.atproto.repo.applyWrites#delete", collection, rkey }));
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
    onBatchDeleted(records.slice(start, end));
  }
}
