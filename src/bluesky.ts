export interface LikeRecord {
  uri: string;
  cid: string;
  value: {
    $type: "app.bsky.feed.like";
    subject: { uri: string; cid: string };
    createdAt: string;
  };
}

export interface ListLikesOptions {
  baseUrl: string;
  did: string;
}

interface LikesPage {
  records: LikeRecord[];
  cursor?: string;
}

const LIKE_COLLECTION = "app.bsky.feed.like";
const PAGE_SIZE = "100";
const LIST_RECORDS = "com.atproto.repo.listRecords";

export async function listLikes(options: ListLikesOptions): Promise<LikeRecord[]> {
  const records: LikeRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchLikesPage(options, cursor);
    records.push(...page.records);
    cursor = page.records.length > 0 ? page.cursor : undefined;
  } while (cursor);
  return records;
}

async function fetchLikesPage(
  { baseUrl, did }: ListLikesOptions,
  cursor: string | undefined,
): Promise<LikesPage> {
  const url = new URL(`/xrpc/${LIST_RECORDS}`, baseUrl);
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", LIKE_COLLECTION);
  url.searchParams.set("limit", PAGE_SIZE);
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${LIST_RECORDS} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as LikesPage;
}
