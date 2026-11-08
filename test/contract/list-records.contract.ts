// Shared contract suite for com.atproto.repo.listRecords (app.bsky.feed.like).
// Holds for any account: it runs against the fake and, opt-in, the real server.
import { expect } from "vitest";

export interface ListRecordsTarget {
  baseUrl: string;
  did: string;
  limit: number;
}

export interface LikeRecord {
  uri: string;
  cid?: string;
  value: { $type?: string; createdAt: string; subject: { uri: string; cid?: string } };
}

interface ListRecordsResponse {
  cursor?: string;
  records: LikeRecord[];
}

const MAX_PAGES = 1000;

export async function walkListRecords(target: ListRecordsTarget): Promise<LikeRecord[][]> {
  const pages: LikeRecord[][] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const url = new URL("/xrpc/com.atproto.repo.listRecords", target.baseUrl);
    url.searchParams.set("repo", target.did);
    url.searchParams.set("collection", "app.bsky.feed.like");
    url.searchParams.set("limit", String(target.limit));
    if (cursor !== undefined) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url);
    expect(response.status, `page ${pageNumber} status`).toBe(200);
    const body = (await response.json()) as ListRecordsResponse;

    expect(body.records.length, `page ${pageNumber} holds at most the limit`).toBeLessThanOrEqual(
      target.limit,
    );

    for (const record of body.records) {
      expect(typeof record.uri, "record has a uri").toBe("string");
      expect(typeof record.value?.createdAt, `record ${record.uri} has value.createdAt`).toBe(
        "string",
      );
      expect(typeof record.value?.subject?.uri, `record ${record.uri} has value.subject.uri`).toBe(
        "string",
      );
      expect(seen.has(record.uri), `record ${record.uri} appears only once across pages`).toBe(
        false,
      );
      seen.add(record.uri);
    }

    pages.push(body.records);

    if (body.records.length === 0) {
      expect(body.cursor, "the empty page has no cursor").toBeUndefined();
      return pages;
    }

    expect(typeof body.cursor, `non-empty page ${pageNumber} carries a cursor`).toBe("string");
    cursor = body.cursor;
  }

  throw new Error(`paging did not end within ${MAX_PAGES} pages`);
}
