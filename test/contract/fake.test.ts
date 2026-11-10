// Feature: feature/delete-old-likes.feature
// Cycle 1: the fake serves likes page by page like the real server.
import { expect, test } from "vitest";
import type { Fetch } from "../../src/bluesky";
import {
  createFakeBluesky,
  type FakeBluesky,
  type NewAccountPost,
  type NewPostSettings,
  type NewRepost,
} from "../fake-bluesky";
import { walkListRecords } from "./list-records.contract";
import { FORBIDDEN_WRITES, walkRejectedWrite, walkWrites } from "./write.contract";

const DID = "did:plc:fakeaccount000000000000";
const BASE_URL = "https://fake-bluesky.test";
const APP_PASSWORD = "fake-app-password";

function addThreeLikes(bluesky: FakeBluesky) {
  return bluesky.addLikes(
    ["a", "b", "c"].map((name, index) => ({
      subject: bluesky.addPost(`post ${name}`).uri,
      createdAt: `2025-01-0${index + 1}T00:00:00.000Z`,
    })),
  );
}

test("fake Bluesky serves 3 likes at limit 2 as pages of 2, 1 and 0 like the real server", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const likes = addThreeLikes(bluesky);

  const pages = await walkListRecords({
    baseUrl: BASE_URL,
    did: DID,
    limit: 2,
    fetch: bluesky.fetch,
  });

  expect(pages.map((page) => page.length)).toStrictEqual([2, 1, 0]);
  expect(
    pages
      .flat()
      .map((record) => record.uri)
      .sort(),
  ).toStrictEqual(likes.map((like) => like.uri).sort());
  expect(
    bluesky.requests().map(({ method, url }) => [method, new URL(url).pathname]),
  ).toStrictEqual(Array(3).fill(["GET", "/xrpc/com.atproto.repo.listRecords"]));
});

test("fake Bluesky logs in and deletes likes in batches of at most 200 like the real server", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
  const [first, second, third] = addThreeLikes(bluesky);

  const { afterDelete } = await walkWrites({
    baseUrl: BASE_URL,
    did: DID,
    appPassword: APP_PASSWORD,
    likeUris: [first.uri, second.uri, third.uri],
    fetch: bluesky.fetch,
  });

  expect(afterDelete).toStrictEqual([third.uri]);
  expect(bluesky.likes().map((like) => like.uri)).toStrictEqual([third.uri]);
});

test.each(FORBIDDEN_WRITES)(
  "fake Bluesky refuses applyWrites carrying $name and applies nothing",
  async (forbidden) => {
    const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
    const [first, second, third] = addThreeLikes(bluesky);

    await walkRejectedWrite(
      {
        baseUrl: BASE_URL,
        did: DID,
        appPassword: APP_PASSWORD,
        likeUris: [first.uri, second.uri, third.uri],
        fetch: bluesky.fetch,
      },
      forbidden,
    );

    expect(bluesky.likes().map((like) => like.uri)).toStrictEqual([
      first.uri,
      second.uri,
      third.uri,
    ]);
  },
);

function seedPost(bluesky: FakeBluesky) {
  return bluesky.addPost("quoted post").uri;
}

test("fake Bluesky serves 150 reposts as pages of 100, 50 and 0, each non-empty page with a cursor", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const subject = seedPost(bluesky);
  const reposts = bluesky.addReposts(
    Array(150).fill({ subject, createdAt: "2025-01-01T00:00:00.000Z" }),
  );

  const pages = await walkListRecords({
    baseUrl: BASE_URL,
    did: DID,
    limit: 100,
    collection: "app.bsky.feed.repost",
    fetch: bluesky.fetch,
  });

  expect(pages.map((page) => page.length)).toStrictEqual([100, 50, 0]);
  expect(
    pages
      .flat()
      .map((record) => record.uri)
      .sort(),
  ).toStrictEqual(reposts.map((repost) => repost.uri).sort());
});

test("fake Bluesky serves a repost that carries via with its via", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const subject = seedPost(bluesky);
  const via = seedPost(bluesky);
  bluesky.addRepost({ subject, via, createdAt: "2025-01-01T00:00:00.000Z" });

  const pages = await walkListRecords({
    baseUrl: BASE_URL,
    did: DID,
    limit: 100,
    collection: "app.bsky.feed.repost",
    fetch: bluesky.fetch,
  });

  expect(pages.flat().map((record) => record.value.via?.uri)).toStrictEqual([via]);
});

test("fake Bluesky deletes 2 of 3 reposts with applyWrites and lists only the third", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
  const subject = seedPost(bluesky);
  const [first, second, third] = bluesky.addReposts(
    [1, 2, 3].map((day) => ({ subject, createdAt: `2025-01-0${day}T00:00:00.000Z` })),
  );

  const { afterDelete } = await walkWrites({
    baseUrl: BASE_URL,
    did: DID,
    appPassword: APP_PASSWORD,
    collection: "app.bsky.feed.repost",
    likeUris: [first.uri, second.uri, third.uri],
    fetch: bluesky.fetch,
  });

  expect(afterDelete).toStrictEqual([third.uri]);
  expect(bluesky.reposts().map((repost) => repost.uri)).toStrictEqual([third.uri]);
});

test("fake Bluesky holds a quote post with an app.bsky.embed.record embed and reads it back", () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const quoted = seedPost(bluesky);

  const quote = bluesky.addAccountPost({
    kind: "quote",
    text: "",
    quoted,
    createdAt: "2025-01-01T00:00:00.000Z",
  });

  expect(bluesky.accountPosts()).toStrictEqual([quote]);
  expect(quote).toMatchObject({ kind: "quote", quoted });
});

test.each([
  {
    kind: "a like",
    collection: "app.bsky.feed.like",
    add: (bluesky: FakeBluesky) =>
      bluesky.addLike({ subject: "not-an-at-uri", createdAt: "2025-01-01T00:00:00.000Z" }),
  },
  {
    kind: "a repost",
    collection: "app.bsky.feed.repost",
    add: (bluesky: FakeBluesky) =>
      bluesky.addRepost({ subject: "not-an-at-uri", createdAt: "2025-01-01T00:00:00.000Z" }),
  },
] as const)(
  "fake Bluesky refuses to serve $kind that breaks its record lexicon",
  async ({ collection, add }) => {
    const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
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

async function listCollection(fetch: Fetch, collection: string) {
  const url = new URL("/xrpc/com.atproto.repo.listRecords", BASE_URL);
  url.searchParams.set("repo", DID);
  url.searchParams.set("collection", collection);
  url.searchParams.set("limit", "100");
  const response = await fetch(url);
  const body = (await response.json()) as {
    records: { uri: string; value: { createdAt?: string } }[];
  };

  return {
    status: response.status,
    records: body.records.map((record) => ({ uri: record.uri, createdAt: record.value.createdAt })),
  };
}

function listReposts(fetch: Fetch) {
  return listCollection(fetch, "app.bsky.feed.repost");
}

test.each([
  { problem: "has no createdAt", createdAt: undefined },
  { problem: "has a createdAt that is not a date", createdAt: "not-a-date" },
])("fake Bluesky serves a repost that $problem as stored", async ({ createdAt }) => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const subject = seedPost(bluesky);
  const repost = bluesky.addRepost({ subject, createdAt } as unknown as NewRepost);

  await expect(listReposts(bluesky.fetch)).resolves.toStrictEqual({
    status: 200,
    records: [{ uri: repost.uri, createdAt }],
  });
});

test("fake Bluesky refuses a quote post that breaks its record lexicon", () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });

  expect(() =>
    bluesky.addAccountPost({
      kind: "quote",
      text: "",
      quoted: "not-an-at-uri",
      createdAt: "2025-01-01T00:00:00.000Z",
    }),
  ).toThrow();
});

const PLAIN_POST: NewAccountPost = {
  kind: "plain",
  text: "a post",
  createdAt: "2025-01-01T00:00:00.000Z",
};

test("fake Bluesky serves 150 posts of the account as pages of 100, 50 and 0, each non-empty page with a cursor", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const posts = Array(150)
    .fill(PLAIN_POST)
    .map((post) => bluesky.addAccountPost(post));

  const pages = await walkListRecords({
    baseUrl: BASE_URL,
    did: DID,
    limit: 100,
    collection: "app.bsky.feed.post",
    fetch: bluesky.fetch,
  });

  expect(pages.map((page) => page.length)).toStrictEqual([100, 50, 0]);
  expect(
    pages
      .flat()
      .map((record) => record.uri)
      .sort(),
  ).toStrictEqual(posts.map((post) => post.uri).sort());
});

test("fake Bluesky deletes 2 of 3 posts with applyWrites and lists only the third", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
  const [first, second, third] = [1, 2, 3].map((day) =>
    bluesky.addAccountPost({ ...PLAIN_POST, createdAt: `2025-01-0${day}T00:00:00.000Z` }),
  );

  const { afterDelete } = await walkWrites({
    baseUrl: BASE_URL,
    did: DID,
    appPassword: APP_PASSWORD,
    collection: "app.bsky.feed.post",
    likeUris: [first.uri, second.uri, third.uri],
    fetch: bluesky.fetch,
  });

  expect(afterDelete).toStrictEqual([third.uri]);
  expect(bluesky.accountPosts().map((post) => post.uri)).toStrictEqual([third.uri]);
});

const PARENT = `at://${DID}/app.bsky.feed.post/parent`;

const QUOTE_WITH_MEDIA: NewAccountPost = {
  kind: "quote",
  text: "",
  quoted: PARENT,
  withMedia: true,
  createdAt: "2025-01-01T00:00:00.000Z",
};

test.each([
  {
    kind: "a reply",
    post: { kind: "reply", text: "a reply", parent: PARENT, createdAt: PLAIN_POST.createdAt },
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
    const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
    const stored = bluesky.addAccountPost(post);

    const pages = await walkListRecords({
      baseUrl: BASE_URL,
      did: DID,
      limit: 100,
      collection: "app.bsky.feed.post",
      fetch: bluesky.fetch,
    });

    expect(pages.flat()).toEqual([
      expect.objectContaining({
        uri: stored.uri,
        value: expect.objectContaining(served),
      }),
    ]);
  },
);

async function addPostAndList(bluesky: FakeBluesky, createdAt: string | undefined) {
  bluesky.addAccountPost({ ...PLAIN_POST, createdAt } as unknown as NewAccountPost);
  return listCollection(bluesky.fetch, "app.bsky.feed.post");
}

test.each([
  { problem: "has no createdAt", createdAt: undefined },
  { problem: "has a createdAt that is not a date", createdAt: "not-a-date" },
])("fake Bluesky serves a post that $problem as stored", async ({ createdAt }) => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });

  await expect(addPostAndList(bluesky, createdAt)).resolves.toStrictEqual({
    status: 200,
    records: [{ uri: expect.stringContaining("/app.bsky.feed.post/"), createdAt }],
  });
});

test("fake Bluesky keeps the posts that likes point at out of the account's post listing", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  bluesky.addPost("a post of another account");
  const own = bluesky.addAccountPost(PLAIN_POST);

  const pages = await walkListRecords({
    baseUrl: BASE_URL,
    did: DID,
    limit: 100,
    collection: "app.bsky.feed.post",
    fetch: bluesky.fetch,
  });

  expect(pages.flat().map((record) => record.uri)).toStrictEqual([own.uri]);
});

test("fake Bluesky mints the posts that likes point at under another account's DID", () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });

  const subject = bluesky.addPost("a post of another account");

  expect(subject.uri.split("/")[2]).not.toBe(DID);
});

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
  return add(bluesky, {
    post,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...extra,
  } as unknown as NewPostSettings);
}

test.each(SETTINGS_KINDS)(
  "fake Bluesky serves 150 $noun as pages of 100, 50 and 0, each non-empty page with a cursor",
  async (kind) => {
    const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
    const settings = Array.from({ length: 150 }, () => addSettingsOf(bluesky, kind));

    const pages = await walkListRecords({
      baseUrl: BASE_URL,
      did: DID,
      limit: 100,
      collection: kind.collection,
      fetch: bluesky.fetch,
    });

    expect(pages.map((page) => page.length)).toStrictEqual([100, 50, 0]);
    expect(
      pages
        .flat()
        .map((record) => record.uri)
        .sort(),
    ).toStrictEqual(settings.map((record) => record.uri).sort());
  },
);

test.each(SETTINGS_KINDS)(
  "fake Bluesky deletes 2 of 3 $noun with applyWrites and lists only the third",
  async (kind) => {
    const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
    const [first, second, third] = [1, 2, 3].map((day) =>
      addSettingsOf(bluesky, kind, { createdAt: `2025-01-0${day}T00:00:00.000Z` }),
    );

    const { afterDelete } = await walkWrites({
      baseUrl: BASE_URL,
      did: DID,
      appPassword: APP_PASSWORD,
      collection: kind.collection,
      likeUris: [first.uri, second.uri, third.uri],
      fetch: bluesky.fetch,
    });

    expect(afterDelete).toStrictEqual([third.uri]);
    expect(kind.stored(bluesky).map((record) => record.uri)).toStrictEqual([third.uri]);
  },
);

test.each(SETTINGS_KINDS)(
  "fake Bluesky serves $noun that carry $optionalField and validate against their record lexicon",
  async (kind) => {
    const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
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
    const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });

    expect(() =>
      addSettingsOf(bluesky, kind, { [kind.optionalField]: ["not-an-at-uri"] }),
    ).toThrow();
  },
);

test.each(
  SETTINGS_KINDS.flatMap((kind) => [
    { ...kind, problem: "has no createdAt", createdAt: undefined },
    { ...kind, problem: "has a createdAt that is not a date", createdAt: "not-a-date" },
  ]),
)("fake Bluesky serves $noun that $problem as stored", async (kind) => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const add = () => addSettingsOf(bluesky, kind, { createdAt: kind.createdAt });

  expect(add).not.toThrow();
  await expect(listCollection(bluesky.fetch, kind.collection)).resolves.toStrictEqual({
    status: 200,
    records: [{ uri: expect.stringContaining(`/${kind.collection}/`), createdAt: kind.createdAt }],
  });
});
