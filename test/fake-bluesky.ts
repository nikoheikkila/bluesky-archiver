import { app, com } from "@bsky/sdk/lexicons";
import { vi } from "vitest";

const CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
const ACCESS_JWT = "fake-access-jwt";
const MAX_WRITES = 200;

// In-process fake of com.atproto.repo.listRecords. It replaces global fetch so
// the suite never reaches the network and rejects any other origin.

export interface FakePost {
  uri: string;
}

export interface FakeLike {
  uri: string;
  subject: string;
  createdAt: string;
}

export interface FakeRepost {
  uri: string;
  subject: string;
  createdAt: string;
  via?: string;
}

export interface FakeQuotePost {
  uri: string;
  quoted: string;
  createdAt: string;
}

export interface FakeBlueskyOptions {
  did: string;
  baseUrl: string;
  appPassword?: string;
}

export interface FakeBluesky {
  addPost(text: string): FakePost;
  deletePost(post: FakePost): void;
  addLike(like: { subject: string; createdAt: string }): FakeLike;
  likes(): FakeLike[];
  addRepost(repost: { subject: string; createdAt: string; via?: string }): FakeRepost;
  addQuotePost(quote: { quoted: string; createdAt: string }): FakeQuotePost;
  quotePosts(): FakeQuotePost[];
  reposts(): FakeRepost[];
  posts(): FakePost[];
  failPage(failure: { cursor: string; status: number }): void;
  failApplyWrites(failure: { call: number; status: number }): void;
  intercept(): void;
  requests(): { method: string; url: string }[];
}

export function createFakeBluesky(options: FakeBlueskyOptions): FakeBluesky {
  let counter = 0;
  const stored: FakeLike[] = [];
  const storedReposts: FakeRepost[] = [];
  const storedPosts: FakePost[] = [];
  const storedQuotes: FakeQuotePost[] = [];
  const served: { method: string; url: string }[] = [];
  const failures = new Map<string, number>();
  const writeFailures = new Map<number, number>();
  let applyWritesCalls = 0;
  // Likes and reposts are served and deleted the same way; only their record shape differs.
  const collections = new Map<string, DeletableCollection>([
    ["app.bsky.feed.like", { stored, toRecord: toLikeRecord, assert: app.bsky.feed.like.$assert }],
    [
      "app.bsky.feed.repost",
      { stored: storedReposts, toRecord: toRepostRecord, assert: app.bsky.feed.repost.$assert },
    ],
  ]);
  const nextUri = (collection: string) => {
    counter++;
    return `at://${options.did}/${collection}/${counter}`;
  };
  return {
    failApplyWrites: ({ call, status }) => {
      writeFailures.set(call, status);
    },
    failPage: ({ cursor, status }) => {
      failures.set(cursor, status);
    },
    addPost: () => {
      const post = { uri: nextUri("app.bsky.feed.post") };
      storedPosts.push(post);
      return post;
    },
    deletePost: (post) => {
      removeByUri(storedPosts, post.uri);
    },
    addLike: (like) => {
      const created = {
        uri: nextUri("app.bsky.feed.like"),
        subject: like.subject,
        createdAt: like.createdAt,
      };
      stored.push(created);
      return created;
    },
    likes: () => stored,
    addRepost: (repost) => {
      const created = {
        uri: nextUri("app.bsky.feed.repost"),
        subject: repost.subject,
        createdAt: repost.createdAt,
        ...(repost.via === undefined ? {} : { via: repost.via }),
      };
      storedReposts.push(created);
      return created;
    },
    reposts: () => storedReposts,
    addQuotePost: (quote) => {
      app.bsky.feed.post.$assert({
        $type: "app.bsky.feed.post",
        text: "",
        embed: { $type: "app.bsky.embed.record", record: { uri: quote.quoted, cid: CID } },
        createdAt: quote.createdAt,
      });
      const created = {
        uri: nextUri("app.bsky.feed.post"),
        quoted: quote.quoted,
        createdAt: quote.createdAt,
      };
      storedQuotes.push(created);
      return created;
    },
    quotePosts: () => storedQuotes,
    posts: () => storedPosts,
    intercept: () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        // Normalising to a Request reads url, method, headers and body the same way for every call style.
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.origin !== new URL(options.baseUrl).origin) {
          throw new Error(`unexpected origin ${url.origin}`);
        }
        const method = request.method;
        served.push({ method, url: url.toString() });
        if (url.pathname === "/xrpc/com.atproto.server.createSession") {
          const body = com.atproto.server.createSession.$input.schema.validate(
            await request.json(),
          );
          if (body.identifier !== options.did || body.password !== options.appPassword) {
            return Response.json(
              { error: "AuthenticationRequired", message: "Invalid identifier or password" },
              { status: 401 },
            );
          }
          const output = {
            accessJwt: ACCESS_JWT,
            refreshJwt: "fake-refresh-jwt",
            handle: "fake.test",
            did: options.did,
          };
          com.atproto.server.createSession.$output.schema.validate(output);
          return Response.json(output);
        }
        if (url.pathname === "/xrpc/com.atproto.repo.applyWrites" && method === "POST") {
          if (request.headers.get("Authorization") !== `Bearer ${ACCESS_JWT}`) {
            return Response.json(
              { error: "AuthenticationRequired", message: "Authentication Required" },
              { status: 401 },
            );
          }
          applyWritesCalls++;
          const writeFailure = writeFailures.get(applyWritesCalls);
          if (writeFailure !== undefined) {
            return Response.json(
              { error: "InternalServerError", message: "Injected failure" },
              { status: writeFailure },
            );
          }
          const body = com.atproto.repo.applyWrites.$input.schema.validate(await request.json());
          if (body.writes.length > MAX_WRITES) {
            return Response.json(
              { error: "InvalidRequest", message: `Too many writes. Max: ${MAX_WRITES}` },
              { status: 400 },
            );
          }
          for (const write of body.writes) {
            if (
              write.$type !== "com.atproto.repo.applyWrites#delete" ||
              !collections.has(write.collection)
            ) {
              return Response.json(
                {
                  error: "InvalidRequest",
                  message: "Only deletes of app.bsky.feed.like are allowed",
                },
                { status: 400 },
              );
            }
          }
          for (const write of body.writes) {
            const uri = `at://${options.did}/${write.collection}/${write.rkey}`;
            for (const { stored } of collections.values()) {
              removeByUri(stored, uri);
            }
          }
          const output = { results: [] };
          com.atproto.repo.applyWrites.$output.schema.validate(output);
          return Response.json(output);
        }
        com.atproto.repo.listRecords.$params.fromURLSearchParams(url.searchParams);
        const failure = failures.get(url.searchParams.get("cursor") ?? "");
        if (failure !== undefined) {
          return Response.json(
            { error: "InternalServerError", message: "Injected failure" },
            { status: failure },
          );
        }
        const repo = url.searchParams.get("repo");
        // Error shape assumed from the PDS; unverified against the live server.
        if (repo !== options.did) {
          return Response.json(
            { error: "InvalidRequest", message: `Could not find repo: ${repo}` },
            { status: 400 },
          );
        }
        const collection = collections.get(url.searchParams.get("collection") ?? "");
        if (collection === undefined) {
          return Response.json({ records: [] });
        }
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const start = Number(url.searchParams.get("cursor") ?? "0");
        const records = collection.stored.slice(start, start + limit).map(collection.toRecord);
        for (const record of records) {
          // A missing or malformed createdAt is served as-is; every other field must be valid.
          collection.assert({ ...record.value, createdAt: "2000-01-01T00:00:00.000Z" });
        }
        // The real server omits the cursor only on the empty page that ends pagination.
        const output =
          records.length === 0 ? { records } : { cursor: String(start + records.length), records };
        com.atproto.repo.listRecords.$output.schema.validate(output);
        return Response.json(output);
      });
    },
    requests: () => served,
  };
}

interface ServedRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

interface DeletableCollection {
  stored: { uri: string }[];
  // biome-ignore lint/suspicious/noExplicitAny: each collection maps its own stored shape.
  toRecord: (item: any) => ServedRecord;
  assert: (value: unknown) => void;
}

function removeByUri(items: { uri: string }[], uri: string) {
  const index = items.findIndex((item) => item.uri === uri);
  if (index !== -1) {
    items.splice(index, 1);
  }
}

function toLikeRecord(like: FakeLike): ServedRecord {
  return {
    uri: like.uri,
    cid: CID,
    value: {
      $type: "app.bsky.feed.like",
      subject: { uri: like.subject, cid: CID },
      ...withCreatedAt(like.createdAt),
    },
  };
}

function toRepostRecord(repost: FakeRepost): ServedRecord {
  return {
    uri: repost.uri,
    cid: CID,
    value: {
      $type: "app.bsky.feed.repost",
      subject: { uri: repost.subject, cid: CID },
      ...withCreatedAt(repost.createdAt),
      ...(repost.via === undefined ? {} : { via: { uri: repost.via, cid: CID } }),
    },
  };
}

function withCreatedAt(createdAt: string | undefined): { createdAt?: string } {
  return createdAt === undefined ? {} : { createdAt };
}
