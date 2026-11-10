import type { Collection, LikeRecord, RecordIn } from "./domain-types";

/** The web `fetch`, passed in so the caller decides where requests go. */
export type Fetch = (input: URL | string, init?: RequestInit) => Promise<Response>;

export interface ListRecordsOptions<C extends Collection = Collection> {
  baseUrl: string;
  did: string;
  collection: C;
  fetch: Fetch;
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
  options: ListRecordsOptions,
  cursor: string | undefined,
): Promise<RecordsPage<T>> {
  const url = new URL(`/xrpc/${LIST_RECORDS}`, options.baseUrl);
  url.searchParams.set("repo", options.did);
  url.searchParams.set("collection", options.collection);
  url.searchParams.set("limit", PAGE_SIZE);
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  const response = await options.fetch(url);
  if (!response.ok) {
    throw new Error(`${LIST_RECORDS} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as RecordsPage<T>;
}
