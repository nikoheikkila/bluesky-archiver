import { vi } from "vitest";

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
}

export interface FakeBluesky {
  addPost(text: string): FakePost;
  deletePost(post: FakePost): void;
  addLike(like: { subject: string; createdAt: string }): FakeLike;
  likes(): FakeLike[];
  failPage(failure: { cursor: string; status: number }): void;
  intercept(): void;
  requests(): { method: string; url: string }[];
}

export function createFakeBluesky(options: FakeBlueskyOptions): FakeBluesky {
  let counter = 0;
  const stored: FakeLike[] = [];
  const served: { method: string; url: string }[] = [];
  const failures = new Map<string, number>();
  return {
    failPage: ({ cursor, status }) => {
      failures.set(cursor, status);
    },
    addPost: () => {
      counter++;
      return { uri: `at://${options.did}/app.bsky.feed.post/${counter}` };
    },
    deletePost: () => {},
    addLike: (like) => {
      counter++;
      const created = { uri: `at://${options.did}/app.bsky.feed.like/${counter}`, subject: like.subject, createdAt: like.createdAt };
      stored.push(created);
      return created;
    },
    likes: () => stored,
    intercept: () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(request ? request.url : String(input));
        if (url.origin !== new URL(options.baseUrl).origin) throw new Error(`unexpected origin ${url.origin}`);
        served.push({ method: request ? request.method : init?.method ?? "GET", url: url.toString() });
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
        const records = stored.slice(start, start + limit).map((like, offset) => toRecord(like, start + offset));
        // The real server omits the cursor only on the empty page that ends pagination.
        if (records.length === 0) return Response.json({ records });
        return Response.json({ cursor: String(start + records.length), records });
      });
    },
    requests: () => served,
  };
}

function toRecord(like: FakeLike, index: number) {
  return {
    uri: like.uri,
    cid: `cid${index}`,
    value: { $type: "app.bsky.feed.like", subject: { uri: like.subject, cid: `cid-subject${index}` }, createdAt: like.createdAt },
  };
}
