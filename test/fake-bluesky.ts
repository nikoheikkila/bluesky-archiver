import { app, com } from "@bsky/sdk/lexicons";

const CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";
const ACCESS_JWT = "fake-access-jwt";
const MAX_WRITES = 200;
const OTHER_ACCOUNT_DID = "did:plc:otheraccount222222222222";

// In-process fake of the Bluesky server. Code under test receives its `fetch` instead of the
// global one, so the suite never reaches the network; it rejects any other origin.

export interface FakePost {
  uri: string;
}

export interface NewLike {
  subject: string;
  createdAt: string;
}

export interface FakeLike extends NewLike {
  uri: string;
}

export interface NewRepost {
  subject: string;
  createdAt: string;
  via?: string;
}

export interface FakeRepost extends NewRepost {
  uri: string;
}

/** One write of an applyWrites call, as the fake received it. */
export interface FakeWrite {
  $type: string;
  collection: string;
  rkey?: string;
}

/** A post of the account itself; posts that likes and reposts point at belong to another account. */
export type NewAccountPost =
  | { kind: "plain"; text: string; createdAt: string }
  | { kind: "reply"; text: string; createdAt: string; parent: string }
  | { kind: "quote"; text: string; createdAt: string; quoted: string; withMedia?: boolean };

export type FakeAccountPost = NewAccountPost & { uri: string };

/** Reply settings (a threadgate) or quote settings (a postgate); shares the record key of its post. */
export interface NewPostSettings {
  post: FakeAccountPost;
  createdAt: string;
  hiddenReplies?: string[];
  detachedEmbeddingUris?: string[];
}

export interface FakePostSettings {
  uri: string;
  post: string;
  createdAt: string;
  hiddenReplies?: string[];
  detachedEmbeddingUris?: string[];
}

export interface FakeBlueskyOptions {
  did: string;
  baseUrl: string;
  appPassword?: string;
}

export interface FakeBluesky {
  addPost(text: string): FakePost;
  deletePost(post: FakePost): void;
  addLike(like: NewLike): FakeLike;
  /** Adds the likes in order, as consecutive addLike calls would. */
  addLikes(likes: NewLike[]): FakeLike[];
  likes(): FakeLike[];
  addRepost(repost: NewRepost): FakeRepost;
  /** Adds the reposts in order, as consecutive addRepost calls would. */
  addReposts(reposts: NewRepost[]): FakeRepost[];
  reposts(): FakeRepost[];
  posts(): FakePost[];
  /** Seeds the account's own posts and settings, served by listRecords and deletable by applyWrites. */
  addAccountPost(post: NewAccountPost): FakeAccountPost;
  accountPosts(): FakeAccountPost[];
  addReplySettings(settings: NewPostSettings): FakePostSettings;
  replySettings(): FakePostSettings[];
  addQuoteSettings(settings: NewPostSettings): FakePostSettings;
  quoteSettings(): FakePostSettings[];
  failPage(failure: { cursor: string; status: number }): void;
  failApplyWrites(failure: { call: number; status: number }): void;
  /** The fake server's endpoint; pass it wherever the code under test takes a `fetch`. */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  requests(): { method: string; url: string }[];
  /** The writes of every authorised applyWrites call, in order, including refused calls. */
  receivedWrites(): FakeWrite[][];
}

export function createFakeBluesky(options: FakeBlueskyOptions): FakeBluesky {
  let counter = 0;
  const stored: FakeLike[] = [];
  const storedReposts: FakeRepost[] = [];
  const storedPosts: FakePost[] = [];
  const storedAccountPosts: FakeAccountPost[] = [];
  const storedReplySettings: FakePostSettings[] = [];
  const storedQuoteSettings: FakePostSettings[] = [];
  const served: { method: string; url: string }[] = [];
  const received: FakeWrite[][] = [];
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
    [
      "app.bsky.feed.post",
      {
        stored: storedAccountPosts,
        toRecord: toServedAccountPost,
        assert: app.bsky.feed.post.$assert,
      },
    ],
    [REPLY_SETTINGS.collection, settingsCollection(storedReplySettings, REPLY_SETTINGS)],
    [QUOTE_SETTINGS.collection, settingsCollection(storedQuoteSettings, QUOTE_SETTINGS)],
  ]);
  const nextUri = (collection: string, did = options.did) => {
    counter++;
    return `at://${did}/${collection}/${counter}`;
  };
  const addLike = (like: NewLike): FakeLike => {
    const created = {
      uri: nextUri("app.bsky.feed.like"),
      subject: like.subject,
      createdAt: like.createdAt,
    };
    stored.push(created);
    return created;
  };
  const addRepost = (repost: NewRepost): FakeRepost => {
    const created = {
      uri: nextUri("app.bsky.feed.repost"),
      subject: repost.subject,
      createdAt: repost.createdAt,
      ...(repost.via === undefined ? {} : { via: repost.via }),
    };
    storedReposts.push(created);
    return created;
  };
  const addSettings = (
    store: FakePostSettings[],
    kind: SettingsKind,
    settings: NewPostSettings,
  ): FakePostSettings => {
    const post = settings.post.uri;
    const extra = {
      ...pickOptional(settings, "hiddenReplies"),
      ...pickOptional(settings, "detachedEmbeddingUris"),
    };
    kind.assert({
      $type: kind.collection,
      post,
      ...kind.rules,
      ...extra,
      createdAt: "2000-01-01T00:00:00.000Z",
    });
    const rkey = recordKey(post);
    const uri = `at://${options.did}/${kind.collection}/${rkey}`;
    if (store.some((existing) => existing.uri === uri)) {
      throw new Error(`duplicate record key ${rkey} in ${kind.collection}`);
    }
    const created = {
      uri,
      post,
      createdAt: settings.createdAt,
      ...extra,
    };
    store.push(created);
    return created;
  };
  return {
    failApplyWrites: ({ call, status }) => {
      writeFailures.set(call, status);
    },
    failPage: ({ cursor, status }) => {
      failures.set(cursor, status);
    },
    addPost: () => {
      const post = { uri: nextUri("app.bsky.feed.post", OTHER_ACCOUNT_DID) };
      storedPosts.push(post);
      return post;
    },
    deletePost: (post) => {
      removeByUri(storedPosts, post.uri);
    },
    addLike,
    addLikes: (likes) => likes.map(addLike),
    likes: () => stored,
    addRepost,
    addReposts: (reposts) => reposts.map(addRepost),
    reposts: () => storedReposts,
    posts: () => storedPosts,
    addAccountPost: (post) => {
      app.bsky.feed.post.$assert({
        ...toAccountPostRecord(post),
        createdAt: "2000-01-01T00:00:00.000Z",
      });
      const created = { ...post, uri: nextUri("app.bsky.feed.post") };
      storedAccountPosts.push(created);
      return created;
    },
    accountPosts: () => storedAccountPosts,
    addReplySettings: (settings) => addSettings(storedReplySettings, REPLY_SETTINGS, settings),
    replySettings: () => storedReplySettings,
    addQuoteSettings: (settings) => addSettings(storedQuoteSettings, QUOTE_SETTINGS, settings),
    quoteSettings: () => storedQuoteSettings,
    fetch: async (input, init) => {
      // Normalising to a Request reads url, method, headers and body the same way for every call style.
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin !== new URL(options.baseUrl).origin) {
        throw new Error(`unexpected origin ${url.origin}`);
      }
      const method = request.method;
      served.push({ method, url: url.toString() });
      if (url.pathname === "/xrpc/com.atproto.server.createSession") {
        const body = com.atproto.server.createSession.$input.schema.validate(await request.json());
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
        const body = com.atproto.repo.applyWrites.$input.schema.validate(await request.json());
        received.push(body.writes.map(toFakeWrite));
        applyWritesCalls++;
        const writeFailure = writeFailures.get(applyWritesCalls);
        if (writeFailure !== undefined) {
          return Response.json(
            { error: "InternalServerError", message: "Injected failure" },
            { status: writeFailure },
          );
        }
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
                message:
                  "Only deletes of app.bsky.feed.like, app.bsky.feed.repost, app.bsky.feed.post, app.bsky.feed.threadgate and app.bsky.feed.postgate are allowed",
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
    },
    requests: () => served,
    receivedWrites: () => received,
  };
}

function toFakeWrite(write: { $type?: string; collection: string; rkey?: string }): FakeWrite {
  return {
    $type: write.$type ?? "",
    collection: write.collection,
    ...(write.rkey === undefined ? {} : { rkey: write.rkey }),
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

/** Reply settings and quote settings differ only in their collection, rules and served field. */
interface SettingsKind {
  collection: string;
  rules: Record<string, unknown>;
  servedField: "hiddenReplies" | "detachedEmbeddingUris";
  assert: (value: unknown) => void;
}

const REPLY_SETTINGS: SettingsKind = {
  collection: "app.bsky.feed.threadgate",
  rules: { allow: [] },
  servedField: "hiddenReplies",
  assert: app.bsky.feed.threadgate.$assert,
};

const QUOTE_SETTINGS: SettingsKind = {
  collection: "app.bsky.feed.postgate",
  rules: { embeddingRules: [{ $type: "app.bsky.feed.postgate#disableRule" }] },
  servedField: "detachedEmbeddingUris",
  assert: app.bsky.feed.postgate.$assert,
};

function settingsCollection(stored: FakePostSettings[], kind: SettingsKind): DeletableCollection {
  return {
    stored,
    toRecord: (settings: FakePostSettings) => ({
      uri: settings.uri,
      cid: CID,
      value: {
        $type: kind.collection,
        post: settings.post,
        ...kind.rules,
        ...withCreatedAt(settings.createdAt),
        ...pickOptional(settings, kind.servedField),
      },
    }),
    assert: kind.assert,
  };
}

function pickOptional<T, K extends keyof T>(item: T, key: K): Partial<Pick<T, K>> {
  return item[key] === undefined ? {} : ({ [key]: item[key] } as Pick<T, K>);
}

function toServedAccountPost(post: FakeAccountPost): ServedRecord {
  return { uri: post.uri, cid: CID, value: toAccountPostRecord(post) };
}

function recordKey(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

function toAccountPostRecord(post: NewAccountPost): Record<string, unknown> {
  const base = { $type: "app.bsky.feed.post", text: post.text, ...withCreatedAt(post.createdAt) };
  switch (post.kind) {
    case "plain":
      return base;
    case "reply":
      return {
        ...base,
        reply: { root: { uri: post.parent, cid: CID }, parent: { uri: post.parent, cid: CID } },
      };
    case "quote":
      return { ...base, embed: toQuoteEmbed(post.quoted, post.withMedia) };
  }
}

function toQuoteEmbed(quoted: string, withMedia: boolean | undefined): Record<string, unknown> {
  const record = { $type: "app.bsky.embed.record", record: { uri: quoted, cid: CID } };
  if (!withMedia) {
    return record;
  }
  return {
    $type: "app.bsky.embed.recordWithMedia",
    record,
    media: {
      $type: "app.bsky.embed.external",
      external: { uri: "https://example.com", title: "", description: "" },
    },
  };
}

function withCreatedAt(createdAt: string | undefined): { createdAt?: string } {
  return createdAt === undefined ? {} : { createdAt };
}
