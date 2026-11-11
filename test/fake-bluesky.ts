import { app, com } from "@bsky/sdk/lexicons";
import { BASE_URL, CID, DID, rkeyOf } from "./constants";

const ACCESS_JWT = "fake-access-jwt";
const MAX_WRITES = 200;
const OTHER_ACCOUNT_DID = "did:plc:otheraccount222222222222";

// In-process fake of the Bluesky server. Code under test receives its `fetch` instead of the
// global one, so the suite never reaches the network; it rejects any other origin.

interface FakePost {
  uri: string;
}

export interface NewLike {
  subject: string;
  createdAt: string;
}

interface FakeLike extends NewLike {
  uri: string;
}

export interface NewRepost {
  subject: string;
  createdAt: string;
  via?: string;
}

interface FakeRepost extends NewRepost {
  uri: string;
}

/** One write of an applyWrites call, as the fake received it. */
interface FakeWrite {
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

interface FakePostSettings {
  uri: string;
  post: string;
  createdAt: string;
  hiddenReplies?: string[];
  detachedEmbeddingUris?: string[];
}

interface FakeBlueskyOptions {
  /** Defaults to the shared test account's DID. */
  did?: string;
  /** Defaults to the shared test server URL. */
  baseUrl?: string;
  /** Without one, every login is refused. */
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
  /** Seeds the account's own posts and settings, served by listRecords and deletable by applyWrites. */
  addAccountPost(post: NewAccountPost): FakeAccountPost;
  accountPosts(): FakeAccountPost[];
  addReplySettings(settings: NewPostSettings): FakePostSettings;
  replySettings(): FakePostSettings[];
  addQuoteSettings(settings: NewPostSettings): FakePostSettings;
  quoteSettings(): FakePostSettings[];
  /** Stores the account's profile with this post pinned; a later call replaces the earlier profile. */
  pinPost(post: FakeAccountPost | FakePost, options?: { cid?: string }): void;
  /** Stores the account's profile with no pinned post. */
  addProfileWithoutPin(): void;
  failPage(failure: { cursor: string; status: number }): void;
  /** Makes the profile read (getRecord for app.bsky.actor.profile) answer with this HTTP status. */
  failProfileRead(failure: { status: number }): void;
  failApplyWrites(failure: { call: number; status: number }): void;
  /** The fake server's endpoint; pass it wherever the code under test takes a `fetch`. */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  requests(): { method: string; url: string }[];
  /** The writes of every authorised applyWrites call, in order, including refused calls. */
  receivedWrites(): FakeWrite[][];
}

export function createFakeBluesky({
  did = DID,
  baseUrl = BASE_URL,
  appPassword,
}: FakeBlueskyOptions = {}): FakeBluesky {
  const options = { did, baseUrl, appPassword };
  let counter = 0;
  const storedPosts: FakePost[] = [];
  const likes = createCollection<FakeLike>(
    "app.bsky.feed.like",
    app.bsky.feed.like.$assert,
    (like) => ({
      uri: like.uri,
      cid: CID,
      value: {
        $type: "app.bsky.feed.like",
        subject: { uri: like.subject, cid: CID },
        ...withCreatedAt(like.createdAt),
      },
    }),
  );
  const reposts = createCollection<FakeRepost>(
    "app.bsky.feed.repost",
    app.bsky.feed.repost.$assert,
    (repost) => ({
      uri: repost.uri,
      cid: CID,
      value: {
        $type: "app.bsky.feed.repost",
        subject: { uri: repost.subject, cid: CID },
        ...withCreatedAt(repost.createdAt),
        ...(repost.via === undefined ? {} : { via: { uri: repost.via, cid: CID } }),
      },
    }),
  );
  const accountPosts = createCollection<FakeAccountPost>(
    "app.bsky.feed.post",
    app.bsky.feed.post.$assert,
    (post) => ({ uri: post.uri, cid: CID, value: toAccountPostRecord(post) }),
  );
  const replySettings = createCollection<FakePostSettings>(
    REPLY_SETTINGS.collection,
    REPLY_SETTINGS.assert,
    toSettingsRecord(REPLY_SETTINGS),
  );
  const quoteSettings = createCollection<FakePostSettings>(
    QUOTE_SETTINGS.collection,
    QUOTE_SETTINGS.assert,
    toSettingsRecord(QUOTE_SETTINGS),
  );
  const collections = new Map<string, Collection>(
    [likes, reposts, accountPosts, replySettings, quoteSettings].map((c) => [c.nsid, c]),
  );
  // One profile record per account: empty, or holding the one stored profile value.
  let storedProfile: Record<string, unknown> | undefined;
  const served: { method: string; url: string }[] = [];
  const received: FakeWrite[][] = [];
  const failures = new Map<string, number>();
  const writeFailures = new Map<number, number>();
  let applyWritesCalls = 0;
  let profileFailure: number | undefined;
  const nextUri = (collection: string, did = options.did) => {
    counter++;
    return `at://${did}/${collection}/${counter}`;
  };
  const add = <T extends { uri: string }>(collection: Collection<T>, item: Omit<T, "uri">): T => {
    const created = { uri: nextUri(collection.nsid), ...item } as T;
    collection.items.push(created);
    return created;
  };
  const addLike = (like: NewLike) => add(likes, like);
  const addRepost = (repost: NewRepost) => add(reposts, repost);
  const addSettings = (
    collection: Collection<FakePostSettings>,
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
    // A settings record shares the record key of its post.
    const uri = `at://${options.did}/${kind.collection}/${rkeyOf(post)}`;
    if (collection.items.some((existing) => existing.uri === uri)) {
      throw new Error(`duplicate record key ${rkeyOf(post)} in ${kind.collection}`);
    }
    const created = { uri, post, createdAt: settings.createdAt, ...extra };
    collection.items.push(created);
    return created;
  };
  return {
    failApplyWrites: ({ call, status }) => {
      writeFailures.set(call, status);
    },
    failProfileRead: ({ status }) => {
      profileFailure = status;
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
    addLikes: (items) => items.map(addLike),
    likes: () => likes.items,
    addRepost,
    addReposts: (items) => items.map(addRepost),
    reposts: () => reposts.items,
    addAccountPost: (post) => {
      app.bsky.feed.post.$assert({
        ...toAccountPostRecord(post),
        createdAt: "2000-01-01T00:00:00.000Z",
      });
      return add(accountPosts, post);
    },
    accountPosts: () => accountPosts.items,
    pinPost: (post, pinOptions) => {
      storedProfile = validProfile({ pinnedPost: { uri: post.uri, cid: pinOptions?.cid ?? CID } });
    },
    addProfileWithoutPin: () => {
      storedProfile = validProfile({ displayName: "Fake account" });
    },
    addReplySettings: (settings) => addSettings(replySettings, REPLY_SETTINGS, settings),
    replySettings: () => replySettings.items,
    addQuoteSettings: (settings) => addSettings(quoteSettings, QUOTE_SETTINGS, settings),
    quoteSettings: () => quoteSettings.items,
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
          for (const { items } of collections.values()) {
            removeByUri(items, uri);
          }
        }
        const output = { results: [] };
        com.atproto.repo.applyWrites.$output.schema.validate(output);
        return Response.json(output);
      }
      if (url.pathname === "/xrpc/com.atproto.repo.getRecord") {
        const params = com.atproto.repo.getRecord.$params.fromURLSearchParams(url.searchParams);
        if (
          params.repo !== options.did ||
          params.collection !== "app.bsky.actor.profile" ||
          params.rkey !== "self"
        ) {
          throw new Error(`unexpected getRecord ${params.collection}/${params.rkey}`);
        }
        const uri = `at://${options.did}/app.bsky.actor.profile/self`;
        if (profileFailure !== undefined) {
          return Response.json(
            {
              error: profileFailure === 400 ? "InvalidRequest" : "InternalServerError",
              message: "Injected failure",
            },
            { status: profileFailure },
          );
        }
        if (storedProfile === undefined) {
          return Response.json(
            { error: "RecordNotFound", message: `Could not locate record: ${uri}` },
            { status: 400 },
          );
        }
        const output = { uri, cid: CID, value: storedProfile };
        com.atproto.repo.getRecord.$output.schema.validate(output);
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
      const records = collection.serve(start, limit);
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

function validProfile(fields: Record<string, unknown>): Record<string, unknown> {
  const value = { $type: "app.bsky.actor.profile", ...fields };
  app.bsky.actor.profile.$assert(value);
  return value;
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

/** One stored collection: what it holds, how its records are served and how they are validated. */
interface Collection<T extends { uri: string } = { uri: string }> {
  nsid: string;
  items: T[];
  serve(start: number, limit: number): ServedRecord[];
  assert: (value: unknown) => void;
}

function createCollection<T extends { uri: string }>(
  nsid: string,
  assert: (value: unknown) => void,
  toRecord: (item: T) => ServedRecord,
): Collection<T> {
  const items: T[] = [];
  return {
    nsid,
    items,
    assert,
    serve: (start, limit) => items.slice(start, start + limit).map(toRecord),
  };
}

function removeByUri(items: { uri: string }[], uri: string) {
  const index = items.findIndex((item) => item.uri === uri);
  if (index !== -1) {
    items.splice(index, 1);
  }
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

function toSettingsRecord(kind: SettingsKind) {
  return (settings: FakePostSettings): ServedRecord => ({
    uri: settings.uri,
    cid: CID,
    value: {
      $type: kind.collection,
      post: settings.post,
      ...kind.rules,
      ...withCreatedAt(settings.createdAt),
      ...pickOptional(settings, kind.servedField),
    },
  });
}

function pickOptional<T, K extends keyof T>(item: T, key: K): Partial<Pick<T, K>> {
  return item[key] === undefined ? {} : ({ [key]: item[key] } as Pick<T, K>);
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
