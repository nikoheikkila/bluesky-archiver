// Counts the account's records older than one year through the public, unauthenticated
// com.atproto.repo.listRecords endpoint, and the requests a daily run would send for them.
// Read-only: it never logs in or writes. It is deliberately independent of src/, so it can
// cross-check the Worker's own counts (a broken listing in src/ would not break this one too).
//
// Usage: bun scripts/count-old.ts [--at <ISO time>] [collection ...]
//   --at        the run start to judge ages against (default: now), e.g. 2026-11-10T03:00:00Z
//   collection  defaults to app.bsky.feed.like and app.bsky.feed.repost
//
// The age rule matches the Worker: a record is old when its own createdAt is more than
// 365 × 24 h before the run start; a missing or unparseable createdAt is undatable, never old.

import { readFile } from "node:fs/promises";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const BATCH_SIZE = 200;
const REQUEST_LIMIT = 50;
const DEFAULT_COLLECTIONS = ["app.bsky.feed.like", "app.bsky.feed.repost"];

interface Page {
  cursor?: string;
  records: { value?: { createdAt?: unknown } }[];
}

interface Count {
  collection: string;
  total: number;
  old: number;
  undatable: number;
  oldest: number;
  requests: number;
}

function readVar(config: string, name: string): string {
  const match = new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`).exec(config);
  if (match?.[1] === undefined) {
    throw new Error(`${name} is missing from wrangler.jsonc vars`);
  }
  return match[1];
}

function parseArgs(args: string[]): { runStart: number; collections: string[] } {
  const atIndex = args.indexOf("--at");
  const at = atIndex === -1 ? undefined : args[atIndex + 1];
  const runStart = at === undefined ? Date.now() : Date.parse(at);
  if (Number.isNaN(runStart)) {
    throw new Error(`--at needs an ISO time, got ${at}`);
  }
  const rest = atIndex === -1 ? args : args.filter((_, i) => i !== atIndex && i !== atIndex + 1);
  return { runStart, collections: rest.length > 0 ? rest : DEFAULT_COLLECTIONS };
}

async function fetchPage(server: string, did: string, collection: string, cursor?: string) {
  const url = new URL("/xrpc/com.atproto.repo.listRecords", server);
  url.searchParams.set("repo", did);
  url.searchParams.set("collection", collection);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (cursor !== undefined) {
    url.searchParams.set("cursor", cursor);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`listRecords ${collection} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as Page;
}

function tally(count: Count, page: Page, runStart: number): void {
  for (const record of page.records) {
    count.total += 1;
    const createdAt = record.value?.createdAt;
    const time = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
    if (Number.isNaN(time)) {
      count.undatable += 1;
      continue;
    }
    if (time < runStart - YEAR_MS) {
      count.old += 1;
    }
    count.oldest = Math.min(count.oldest, time);
  }
}

async function countOld(server: string, did: string, collection: string, runStart: number) {
  const count: Count = {
    collection,
    total: 0,
    old: 0,
    undatable: 0,
    oldest: Number.POSITIVE_INFINITY,
    requests: 0,
  };
  let cursor: string | undefined;
  do {
    const page = await fetchPage(server, did, collection, cursor);
    count.requests += 1;
    tally(count, page, runStart);
    cursor = page.records.length > 0 ? page.cursor : undefined;
  } while (cursor !== undefined);
  return count;
}

function describe(count: Count): string {
  const oldest = Number.isFinite(count.oldest) ? new Date(count.oldest).toISOString() : "none";
  return [
    `${count.collection}: ${count.total} records, ${count.old} older than one year,`,
    `${count.undatable} undatable, oldest ${oldest}, ${count.requests} listRecords requests`,
  ].join(" ");
}

function describeBudget(counts: Count[]): string {
  const listing = counts.reduce((sum, count) => sum + count.requests, 0);
  const login = counts.some((count) => count.old > 0) ? 1 : 0;
  const writes = counts.reduce((sum, count) => sum + Math.ceil(count.old / BATCH_SIZE), 0);
  const total = listing + login + writes;
  return `A run would send ${listing} listRecords + ${login} createSession + ${writes} applyWrites = ${total} requests (limit ${REQUEST_LIMIT})`;
}

async function main(): Promise<void> {
  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const pds = readVar(wrangler, "BLUESKY_SERVER_URL");
  const repo = readVar(wrangler, "BLUESKY_DID");
  const options = parseArgs(process.argv.slice(2));
  const start = options.runStart;

  console.log(
    `Run start ${new Date(start).toISOString()}, cutoff ${new Date(start - YEAR_MS).toISOString()}`,
  );
  const results: Count[] = [];
  for (const nsid of options.collections) {
    const result = await countOld(pds, repo, nsid, start);
    results.push(result);
    console.log(describe(result));
  }
  console.log(describeBudget(results));
}

await main();
