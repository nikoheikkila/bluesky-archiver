// Feature: feature/delete-old-likes.feature
// Cycle 1: the fake serves likes page by page like the real server.
import { expect, test } from "vitest";
import type { Fetch } from "../../src/bluesky";
import type { Collection } from "../../src/domain-types";
import { APP_PASSWORD, BASE_URL, CID, DID } from "../constants";
import {
  createFakeBluesky,
  type FakeBluesky,
  type NewAccountPost,
  type NewPostSettings,
  type NewRepost,
} from "../fake-bluesky";
import {
  fetchRecord,
  PROFILE_COLLECTION,
  profileUri,
  walkMissingProfile,
  walkProfile,
} from "./get-record.contract";
import { fetchPage, walkListRecords } from "./list-records.contract";
import { FORBIDDEN_WRITES, walkRejectedWrite, walkWrites } from "./write.contract";

const CREATED_AT = "2025-01-01T00:00:00.000Z";

function addThreeLikes(bluesky: FakeBluesky) {
  return bluesky.addLikes(
    ["a", "b", "c"].map((name, index) => ({
      subject: bluesky.addPost(`post ${name}`).uri,
      createdAt: `2025-01-0${index + 1}T00:00:00.000Z`,
    })),
  );
}

function seedPost(bluesky: FakeBluesky) {
  return bluesky.addPost("quoted post").uri;
}

const PLAIN_POST: NewAccountPost = { kind: "plain", text: "a post", createdAt: CREATED_AT };

const SETTINGS_KINDS = [
  {
    noun: "reply settings",
    collection: "app.bsky.feed.threadgate",
    add: (bluesky: FakeBluesky, settings: NewPostSettings) => bluesky.addReplySettings(settings),
    stored: (bluesky: FakeBluesky) => bluesky.replySettings(),
    optionalField: "hiddenReplies",
  },
  {
    noun: "quote settings",
    collection: "app.bsky.feed.postgate",
    add: (bluesky: FakeBluesky, settings: NewPostSettings) => bluesky.addQuoteSettings(settings),
    stored: (bluesky: FakeBluesky) => bluesky.quoteSettings(),
    optionalField: "detachedEmbeddingUris",
  },
] as const;

type SettingsKind = (typeof SETTINGS_KINDS)[number];

// Settings share the record key of their post, so each settings record gets a post of its own.
// The narrow cast carries what the harness types lack: the optional lexicon fields and an undatable createdAt.
function addSettingsOf(
  bluesky: FakeBluesky,
  { add }: SettingsKind,
  extra: Record<string, unknown> = {},
) {
  const post = bluesky.addAccountPost(PLAIN_POST);
  return add(bluesky, { post, createdAt: CREATED_AT, ...extra } as unknown as NewPostSettings);
}

// All five served collections. `seed` stores one record; a test that needs no createdAt or a
// malformed one passes it explicitly, hence the cast.
interface ServedCollection {
  noun: string;
  collection: Collection;
  seed(bluesky: FakeBluesky, record?: { createdAt?: string }): { uri: string };
  stored(bluesky: FakeBluesky): { uri: string }[];
}

const COLLECTIONS: ServedCollection[] = [
  {
    noun: "likes",
    collection: "app.bsky.feed.like",
    seed: (
      bluesky: FakeBluesky,
      { createdAt }: { createdAt?: string } = { createdAt: CREATED_AT },
    ) => bluesky.addLike({ subject: seedPost(bluesky), createdAt } as NewRepost),
    stored: (bluesky: FakeBluesky) => bluesky.likes(),
  },
  {
    noun: "reposts",
    collection: "app.bsky.feed.repost",
    seed: (
      bluesky: FakeBluesky,
      { createdAt }: { createdAt?: string } = { createdAt: CREATED_AT },
    ) => bluesky.addRepost({ subject: seedPost(bluesky), createdAt } as NewRepost),
    stored: (bluesky: FakeBluesky) => bluesky.reposts(),
  },
  {
    noun: "posts",
    collection: "app.bsky.feed.post",
    seed: (
      bluesky: FakeBluesky,
      { createdAt }: { createdAt?: string } = { createdAt: CREATED_AT },
    ) => bluesky.addAccountPost({ ...PLAIN_POST, createdAt } as NewAccountPost),
    stored: (bluesky: FakeBluesky) => bluesky.accountPosts(),
  },
  ...SETTINGS_KINDS.map((kind) => ({
    noun: kind.noun,
    collection: kind.collection,
    seed: (
      bluesky: FakeBluesky,
      { createdAt }: { createdAt?: string } = { createdAt: CREATED_AT },
    ) => addSettingsOf(bluesky, kind, { createdAt }),
    stored: kind.stored,
  })),
];

const uris = (records: { uri: string }[]) => records.map((record) => record.uri);

test("fake Bluesky serves 3 likes at limit 2 as pages of 2, 1 and 0 like the real server", async () => {
  const bluesky = createFakeBluesky();
  const likes = addThreeLikes(bluesky);

  const pages = await walkListRecords({
    baseUrl: BASE_URL,
    did: DID,
    limit: 2,
    fetch: bluesky.fetch,
  });

  expect(pages.map((page) => page.length)).toStrictEqual([2, 1, 0]);
  expect(uris(pages.flat()).sort()).toStrictEqual(uris(likes).sort());
  expect(
    bluesky.requests().map(({ method, url }) => [method, new URL(url).pathname]),
  ).toStrictEqual(Array(3).fill(["GET", "/xrpc/com.atproto.repo.listRecords"]));
});

test.each(COLLECTIONS)(
  "fake Bluesky serves 150 $noun as pages of 100, 50 and 0, each non-empty page with a cursor",
  async ({ collection, seed }) => {
    const bluesky = createFakeBluesky();
    const records = Array.from({ length: 150 }, () => seed(bluesky));

    const pages = await walkListRecords({
      baseUrl: BASE_URL,
      did: DID,
      limit: 100,
      collection,
      fetch: bluesky.fetch,
    });

    expect(pages.map((page) => page.length)).toStrictEqual([100, 50, 0]);
    expect(uris(pages.flat()).sort()).toStrictEqual(uris(records).sort());
  },
);

test.each(COLLECTIONS)(
  "fake Bluesky logs in and deletes 2 of 3 $noun with applyWrites and lists only the third",
  async ({ collection, seed, stored }) => {
    const bluesky = createFakeBluesky({ appPassword: APP_PASSWORD });
    const [first, second, third] = [1, 2, 3].map((day) =>
      seed(bluesky, { createdAt: `2025-01-0${day}T00:00:00.000Z` }),
    );

    const { afterDelete } = await walkWrites({
      baseUrl: BASE_URL,
      did: DID,
      appPassword: APP_PASSWORD,
      collection,
      recordUris: [first.uri, second.uri, third.uri],
      fetch: bluesky.fetch,
    });

    expect(afterDelete).toStrictEqual([third.uri]);
    expect(uris(stored(bluesky))).toStrictEqual([third.uri]);
  },
);

test.each(FORBIDDEN_WRITES)(
  "fake Bluesky refuses applyWrites carrying $name and applies nothing",
  async (forbidden) => {
    const bluesky = createFakeBluesky({ appPassword: APP_PASSWORD });
    const likes = addThreeLikes(bluesky);

    await walkRejectedWrite(
      {
        baseUrl: BASE_URL,
        did: DID,
        appPassword: APP_PASSWORD,
        recordUris: [likes[0].uri, likes[1].uri, likes[2].uri],
        fetch: bluesky.fetch,
      },
      forbidden,
    );

    expect(uris(bluesky.likes())).toStrictEqual(uris(likes));
  },
);

test("fake Bluesky serves a repost that carries via with its via", async () => {
  const bluesky = createFakeBluesky();
  const subject = seedPost(bluesky);
  const via = seedPost(bluesky);
  bluesky.addRepost({ subject, via, createdAt: CREATED_AT });

  const pages = await walkListRecords({
    baseUrl: BASE_URL,
    did: DID,
    limit: 100,
    collection: "app.bsky.feed.repost",
    fetch: bluesky.fetch,
  });

  expect(pages.flat().map((record) => record.value.via?.uri)).toStrictEqual([via]);
});

test("fake Bluesky holds a quote post with an app.bsky.embed.record embed and reads it back", () => {
  const bluesky = createFakeBluesky();
  const quoted = seedPost(bluesky);

  const quote = bluesky.addAccountPost({ kind: "quote", text: "", quoted, createdAt: CREATED_AT });

  expect(bluesky.accountPosts()).toStrictEqual([quote]);
  expect(quote).toMatchObject({ kind: "quote", quoted });
});

test.each([
  {
    kind: "a like",
    collection: "app.bsky.feed.like",
    add: (bluesky: FakeBluesky) =>
      bluesky.addLike({ subject: "not-an-at-uri", createdAt: CREATED_AT }),
  },
  {
    kind: "a repost",
    collection: "app.bsky.feed.repost",
    add: (bluesky: FakeBluesky) =>
      bluesky.addRepost({ subject: "not-an-at-uri", createdAt: CREATED_AT }),
  },
] as const)(
  "fake Bluesky refuses to serve $kind that breaks its record lexicon",
  async ({ collection, add }) => {
    const bluesky = createFakeBluesky();
    add(bluesky);

    await expect(
      walkListRecords({
        baseUrl: BASE_URL,
        did: DID,
        limit: 100,
        collection,
        fetch: bluesky.fetch,
      }),
    ).rejects.toThrow();
  },
);

test.each(
  COLLECTIONS.flatMap((kind) => [
    { ...kind, problem: "has no createdAt", createdAt: undefined },
    { ...kind, problem: "has a createdAt that is not a date", createdAt: "not-a-date" },
  ]),
)("fake Bluesky serves $noun whose record $problem as stored", async (kind) => {
  const bluesky = createFakeBluesky();
  const record = kind.seed(bluesky, { createdAt: kind.createdAt });

  const page = await fetchPage({
    baseUrl: BASE_URL,
    did: DID,
    limit: 100,
    collection: kind.collection,
    fetch: bluesky.fetch,
  });

  expect(page.status).toBe(200);
  expect(page.records.map(({ uri, value }) => [uri, value.createdAt])).toStrictEqual([
    [record.uri, kind.createdAt],
  ]);
});

test("fake Bluesky refuses a quote post that breaks its record lexicon", () => {
  const bluesky = createFakeBluesky();

  expect(() =>
    bluesky.addAccountPost({
      kind: "quote",
      text: "",
      quoted: "not-an-at-uri",
      createdAt: CREATED_AT,
    }),
  ).toThrow();
});

const PARENT = `at://${DID}/app.bsky.feed.post/parent`;

const QUOTE_WITH_MEDIA: NewAccountPost = {
  kind: "quote",
  text: "",
  quoted: PARENT,
  withMedia: true,
  createdAt: CREATED_AT,
};

test.each([
  {
    kind: "a reply",
    post: { kind: "reply", text: "a reply", parent: PARENT, createdAt: CREATED_AT },
    served: {
      reply: {
        root: { uri: PARENT, cid: expect.any(String) },
        parent: { uri: PARENT, cid: expect.any(String) },
      },
    },
  },
  {
    kind: "a quote post with an app.bsky.embed.recordWithMedia embed",
    post: QUOTE_WITH_MEDIA,
    served: { embed: expect.objectContaining({ $type: "app.bsky.embed.recordWithMedia" }) },
  },
] as { kind: string; post: NewAccountPost; served: Record<string, unknown> }[])(
  "fake Bluesky serves $kind that validates against its record lexicon",
  async ({ post, served }) => {
    const bluesky = createFakeBluesky();
    const stored = bluesky.addAccountPost(post);

    const pages = await walkListRecords({
      baseUrl: BASE_URL,
      did: DID,
      limit: 100,
      collection: "app.bsky.feed.post",
      fetch: bluesky.fetch,
    });

    expect(pages.flat()).toEqual([
      expect.objectContaining({ uri: stored.uri, value: expect.objectContaining(served) }),
    ]);
  },
);

test("fake Bluesky keeps the posts that likes point at out of the account's post listing", async () => {
  const bluesky = createFakeBluesky();
  bluesky.addPost("a post of another account");
  const own = bluesky.addAccountPost(PLAIN_POST);

  const pages = await walkListRecords({
    baseUrl: BASE_URL,
    did: DID,
    limit: 100,
    collection: "app.bsky.feed.post",
    fetch: bluesky.fetch,
  });

  expect(uris(pages.flat())).toStrictEqual([own.uri]);
});

test("fake Bluesky mints the posts that likes point at under a well-formed did:plc of another account", () => {
  const bluesky = createFakeBluesky();

  const subject = bluesky.addPost("a post of another account");

  expect(subject.uri.split("/")[2]).toBe("did:plc:otheraccount222222222222");
  expect(subject.uri).toMatch(
    /^at:\/\/did:plc:otheraccount222222222222\/app\.bsky\.feed\.post\/[A-Za-z0-9._~:-]+$/,
  );
});

test.each(SETTINGS_KINDS)(
  "fake Bluesky serves $noun that carry $optionalField and validate against their record lexicon",
  async (kind) => {
    const bluesky = createFakeBluesky();
    const extra = { [kind.optionalField]: [`at://${DID}/app.bsky.feed.post/other`] };
    const stored = addSettingsOf(bluesky, kind, extra);

    const pages = await walkListRecords({
      baseUrl: BASE_URL,
      did: DID,
      limit: 100,
      collection: kind.collection,
      fetch: bluesky.fetch,
    });

    expect(pages.flat()).toEqual([
      expect.objectContaining({ uri: stored.uri, value: expect.objectContaining(extra) }),
    ]);
  },
);

test.each(SETTINGS_KINDS)(
  "fake Bluesky refuses $noun whose $optionalField break their record lexicon",
  (kind) => {
    const bluesky = createFakeBluesky();

    expect(() =>
      addSettingsOf(bluesky, kind, { [kind.optionalField]: ["not-an-at-uri"] }),
    ).toThrow();
  },
);

test.each(SETTINGS_KINDS)(
  "fake Bluesky refuses a second $noun record for the same post like a duplicate record key",
  (kind) => {
    const bluesky = createFakeBluesky();
    const post = bluesky.addAccountPost(PLAIN_POST);
    const settings = { post, createdAt: CREATED_AT } as NewPostSettings;
    const first = kind.add(bluesky, settings);

    expect(() => kind.add(bluesky, settings)).toThrow();
    expect(kind.stored(bluesky)).toStrictEqual([first]);
  },
);

test("fake Bluesky keeps reply settings and quote settings of one post together", () => {
  const bluesky = createFakeBluesky();
  const post = bluesky.addAccountPost(PLAIN_POST);
  const settings = { post, createdAt: "2025-01-01T00:00:00.000Z" } as NewPostSettings;

  const reply = bluesky.addReplySettings(settings);
  const quote = bluesky.addQuoteSettings(settings);

  expect(bluesky.replySettings()).toStrictEqual([reply]);
  expect(bluesky.quoteSettings()).toStrictEqual([quote]);
});

test("fake Bluesky serves the profile with a pinned post through getRecord and validates it against its lexicon", async () => {
  const bluesky = createFakeBluesky();
  const post = bluesky.addAccountPost(PLAIN_POST);
  bluesky.pinPost(post);

  const served = await walkProfile({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch });

  expect(served).toStrictEqual({
    uri: profileUri(DID),
    cid: expect.any(String),
    value: { $type: PROFILE_COLLECTION, pinnedPost: { uri: post.uri, cid: expect.any(String) } },
  });
});

test("fake Bluesky serves the profile of a pinned post of another account through getRecord", async () => {
  const bluesky = createFakeBluesky();
  const post = bluesky.addPost("a post of another account");
  bluesky.pinPost(post);

  const served = await walkProfile({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch });

  expect(served.value?.pinnedPost?.uri).toBe(post.uri);
});

test("fake Bluesky serves a profile without a pinned post through getRecord without pinnedPost", async () => {
  const bluesky = createFakeBluesky();
  bluesky.addProfileWithoutPin();

  const served = await walkProfile({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch });

  expect(served.value).not.toHaveProperty("pinnedPost");
});

test("fake Bluesky answers getRecord with HTTP 400 RecordNotFound when no profile is stored", async () => {
  const bluesky = createFakeBluesky();

  await walkMissingProfile({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch });
});

test.each([
  { status: 500, problem: "a server failure" },
  { status: 400, problem: "a client error other than RecordNotFound" },
])(
  "fake Bluesky answers the profile read with HTTP $status for $problem when it is injected",
  async ({ status }) => {
    const bluesky = createFakeBluesky();
    bluesky.pinPost(bluesky.addAccountPost(PLAIN_POST));
    bluesky.failProfileRead({ status });

    const response = await fetchRecord({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch });

    expect(response).toStrictEqual({
      status,
      body: { error: expect.not.stringMatching(/^RecordNotFound$/), message: expect.any(String) },
    });
  },
);

test.each([
  { problem: "another collection", collection: "app.bsky.feed.post", rkey: "self" },
  { problem: "another record key", collection: PROFILE_COLLECTION, rkey: "other" },
])("fake Bluesky refuses a getRecord for $problem by throwing", async ({ collection, rkey }) => {
  const bluesky = createFakeBluesky();
  bluesky.pinPost(bluesky.addAccountPost(PLAIN_POST));

  await expect(
    fetchRecord({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch, collection, rkey }),
  ).rejects.toThrow();
});

test("the getRecord contract rejects a served profile that breaks its lexicon", async () => {
  const broken: Fetch = async () =>
    Response.json({
      uri: profileUri(DID),
      cid: CID,
      value: {
        $type: PROFILE_COLLECTION,
        pinnedPost: { uri: "not-an-at-uri", cid: "not-a-cid" },
      },
    });

  await expect(walkProfile({ baseUrl: BASE_URL, did: DID, fetch: broken })).rejects.toThrow(
    "the served profile validates against its lexicon",
  );
});
