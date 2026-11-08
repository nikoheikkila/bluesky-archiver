import { vi } from "vitest";
import { com } from "@bsky/sdk/lexicons";

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
  posts(): FakePost[];
  failPage(failure: { cursor: string; status: number }): void;
  intercept(): void;
  requests(): { method: string; url: string }[];
}

export function createFakeBluesky(options: FakeBlueskyOptions): FakeBluesky {
  let counter = 0;
  const stored: FakeLike[] = [];
  const storedPosts: FakePost[] = [];
  const served: { method: string; url: string }[] = [];
  const failures = new Map<string, number>();
  return {
    failPage: ({ cursor, status }) => {
      failures.set(cursor, status);
    },
    addPost: () => {
      counter++;
      const post = { uri: `at://${options.did}/app.bsky.feed.post/${counter}` };
      storedPosts.push(post);
      return post;
    },
    deletePost: (post) => {
      const index = storedPosts.findIndex((stored) => stored.uri === post.uri);
      if (index !== -1) storedPosts.splice(index, 1);
    },
    addLike: (like) => {
      counter++;
      const created = { uri: `at://${options.did}/app.bsky.feed.like/${counter}`, subject: like.subject, createdAt: like.createdAt };
      stored.push(created);
      return created;
    },
    likes: () => stored,
    posts: () => storedPosts,
    intercept: () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        // Normalising to a Request reads url, method, headers and body the same way for every call style.
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.origin !== new URL(options.baseUrl).origin) throw new Error(`unexpected origin ${url.origin}`);
        const method = request.method;
        served.push({ method, url: url.toString() });
        if (url.pathname === "/xrpc/com.atproto.server.createSession") {
          const body = com.atproto.server.createSession.$input.schema.validate(await request.json());
          if (body.identifier !== options.did || body.password !== options.appPassword) {
            return Response.json({ error: "AuthenticationRequired", message: "Invalid identifier or password" }, { status: 401 });
          }
          const output = { accessJwt: ACCESS_JWT, refreshJwt: "fake-refresh-jwt", handle: "fake.test", did: options.did };
          com.atproto.server.createSession.$output.schema.validate(output);
          return Response.json(output);
        }
        if (url.pathname === "/xrpc/com.atproto.repo.applyWrites" && method === "POST") {
          if (request.headers.get("Authorization") !== `Bearer ${ACCESS_JWT}`) {
            return Response.json({ error: "AuthenticationRequired", message: "Authentication Required" }, { status: 401 });
          }
          const body = com.atproto.repo.applyWrites.$input.schema.validate(await request.json());
          if (body.writes.length > MAX_WRITES) {
            return Response.json({ error: "InvalidRequest", message: `Too many writes. Max: ${MAX_WRITES}` }, { status: 400 });
          }
          for (const write of body.writes) {
            if (write.$type !== "com.atproto.repo.applyWrites#delete" || write.collection !== "app.bsky.feed.like") {
              return Response.json({ error: "InvalidRequest", message: "Only deletes of app.bsky.feed.like are allowed" }, { status: 400 });
            }
          }
          for (const write of body.writes) {
            const uri = `at://${options.did}/app.bsky.feed.like/${write.rkey}`;
            const index = stored.findIndex((like) => like.uri === uri);
            if (index !== -1) stored.splice(index, 1);
          }
          const output = { results: [] };
          com.atproto.repo.applyWrites.$output.schema.validate(output);
          return Response.json(output);
        }
        com.atproto.repo.listRecords.$params.fromURLSearchParams(url.searchParams);
        const failure = failures.get(url.searchParams.get("cursor") ?? "");
        if (failure !== undefined) {
          return Response.json({ error: "InternalServerError", message: "Injected failure" }, { status: failure });
        }
        const repo = url.searchParams.get("repo");
        // Error shape assumed from the PDS; unverified against the live server.
        if (repo !== options.did) {
          return Response.json(
            { error: "InvalidRequest", message: `Could not find repo: ${repo}` },
            { status: 400 },
          );
        }
        // The fake holds only likes, so any other collection is empty.
        if (url.searchParams.get("collection") !== "app.bsky.feed.like") {
          return Response.json({ records: [] });
        }
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const start = Number(url.searchParams.get("cursor") ?? "0");
        const records = stored.slice(start, start + limit).map(toRecord);
        // The real server omits the cursor only on the empty page that ends pagination.
        const output = records.length === 0 ? { records } : { cursor: String(start + records.length), records };
        com.atproto.repo.listRecords.$output.schema.validate(output);
        return Response.json(output);
      });
    },
    requests: () => served,
  };
}

function toRecord(like: FakeLike) {
  return {
    uri: like.uri,
    cid: CID,
    value: { $type: "app.bsky.feed.like", subject: { uri: like.subject, cid: CID }, createdAt: like.createdAt },
  };
}
