interface SubjectRecordOf<C extends string> {
  uri: string;
  cid: string;
  value: {
    $type: C;
    subject: { uri: string; cid: string };
    createdAt: string;
  };
}

export type LikeRecord = SubjectRecordOf<"app.bsky.feed.like">;
export type RepostRecord = SubjectRecordOf<"app.bsky.feed.repost">;
export type SubjectRecord = LikeRecord | RepostRecord;

export type Collection = SubjectRecord["value"]["$type"];
type RecordIn<C extends Collection> = Extract<SubjectRecord, { value: { $type: C } }>;

export interface ListRecordsOptions<C extends Collection = Collection> {
  baseUrl: string;
  did: string;
  collection: C;
}

export type ListLikesOptions = Omit<ListRecordsOptions, "collection">;

interface RecordsPage<T> {
  records: T[];
  cursor?: string;
}

export const LIKE_COLLECTION = "app.bsky.feed.like";
const PAGE_SIZE = "100";
const LIST_RECORDS = "com.atproto.repo.listRecords";

export function listLikes(options: ListLikesOptions): Promise<LikeRecord[]> {
  return listRecords({ ...options, collection: LIKE_COLLECTION });
}

// Record order follows record keys, not createdAt, so every page must be scanned.
export async function listRecords<C extends Collection>(
  options: ListRecordsOptions<C>,
): Promise<RecordIn<C>[]> {
  const records: RecordIn<C>[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage<RecordIn<C>>(options, cursor);
    records.push(...page.records);
    cursor = page.records.length > 0 ? page.cursor : undefined;
  } while (cursor);
  return records;
}

async function fetchPage<T>(
  { baseUrl, did, collection }: ListRecordsOptions,
  cursor: string | undefined,
): Promise<RecordsPage<T>> {
  const url = new URL(`/xrpc/${LIST_RECORDS}`, baseUrl);
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", collection);
  url.searchParams.set("limit", PAGE_SIZE);
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${LIST_RECORDS} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as RecordsPage<T>;
}
