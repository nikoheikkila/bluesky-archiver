import { failRequest, readJson } from "./body";
import type { Collection, RecordIn } from "./domain-types";

/** The web `fetch`, passed in so the caller decides where requests go. */
export type Fetch = (input: URL | string, init?: RequestInit) => Promise<Response>;

/** Where the account's repository lives, and how requests reach it. */
export interface Repo {
  baseUrl: string;
  did: string;
  fetch: Fetch;
}

export interface ListRecordsOptions<C extends Collection = Collection> extends Repo {
  collection: C;
}

interface RecordsPage<T> {
  records: T[];
  cursor?: string;
}

const LIST_RECORDS = "com.atproto.repo.listRecords";

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
  { baseUrl, did, collection, fetch }: ListRecordsOptions,
  cursor: string | undefined,
): Promise<RecordsPage<T>> {
  const url = new URL(`/xrpc/${LIST_RECORDS}`, baseUrl);
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", collection);
  url.searchParams.set("limit", "100");
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  const response = await fetch(url);
  if (!response.ok) {
    return failRequest(response, LIST_RECORDS);
  }
  return readJson<RecordsPage<T>>(response);
}
