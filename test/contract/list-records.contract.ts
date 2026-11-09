// Shared contract suite for com.atproto.repo.listRecords (app.bsky.feed.like and app.bsky.feed.repost).
// Holds for any account: it runs against the fake and, opt-in, the real server.
import { expect } from "vitest";
import type { Fetch } from "../../src/bluesky";

export interface ListRecordsTarget {
  baseUrl: string;
  did: string;
  limit: number;
  fetch: Fetch;
  /** Defaults to app.bsky.feed.like. */
  collection?: "app.bsky.feed.like" | "app.bsky.feed.repost";
}

export interface LikeRecord {
  uri: string;
  cid?: string;
  value: {
    $type?: string;
    createdAt: string;
    subject: { uri: string; cid?: string };
    via?: { uri: string; cid?: string };
  };
}

interface ListRecordsPage {
  status: number;
  cursor?: string;
  records: LikeRecord[];
}

const MAX_PAGES = 1000;

async function fetchPage(target: ListRecordsTarget, cursor?: string): Promise<ListRecordsPage> {
  const url = new URL("/xrpc/com.atproto.repo.listRecords", target.baseUrl);
  const params = {
    repo: target.did,
    collection: target.collection ?? "app.bsky.feed.like",
    limit: String(target.limit),
    cursor,
  };
  // The first page is asked for without a cursor.
  url.search = new URLSearchParams(
    Object.entries(params).filter((param): param is [string, string] => param[1] !== undefined),
  ).toString();
  const response = await target.fetch(url);
  const body = (await response.json()) as Omit<ListRecordsPage, "status">;
  return { status: response.status, ...body };
}

// Paging ends on the first empty page, so how many pages exist is what the walk finds out.
// This loop is the one place in the tests that iterates; every assertion runs after it.
async function fetchAllPages(target: ListRecordsTarget): Promise<ListRecordsPage[]> {
  const pages: ListRecordsPage[] = [];
  let page: ListRecordsPage;
  do {
    page = await fetchPage(target, pages.at(-1)?.cursor);
    pages.push(page);
  } while (page.status === 200 && page.records.length > 0 && pages.length < MAX_PAGES);
  return pages;
}

export async function walkListRecords(target: ListRecordsTarget): Promise<LikeRecord[][]> {
  const pages = await fetchAllPages(target);
  const nonEmpty = pages.slice(0, -1);

  expect(pages.length, "paging ends within the page limit").toBeLessThan(MAX_PAGES);
  expect(nonEmpty, "every non-empty page is a 200 that carries a cursor").toStrictEqual(
    Array(nonEmpty.length).fill({
      status: 200,
      cursor: expect.any(String),
      records: expect.any(Array),
    }),
  );
  expect(pages.at(-1), "paging ends on an empty 200 page without a cursor").toStrictEqual({
    status: 200,
    records: [],
  });
  expect(
    Math.max(0, ...pages.map((page) => page.records.length)),
    "no page holds more than the limit",
  ).toBeLessThanOrEqual(target.limit);

  const records = pages.flatMap((page) => page.records);
  const uris = records.map((record) => record.uri);
  expect(records, "every record has a uri, value.createdAt and value.subject.uri").toEqual(
    Array(records.length).fill(
      expect.objectContaining({
        uri: expect.any(String),
        value: expect.objectContaining({
          createdAt: expect.any(String),
          subject: expect.objectContaining({ uri: expect.any(String) }),
        }),
      }),
    ),
  );
  expect(new Set(uris).size, "every record appears only once across pages").toBe(uris.length);

  return pages.map((page) => page.records);
}
