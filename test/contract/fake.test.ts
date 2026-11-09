// Feature: feature/delete-old-likes.feature
// Cycle 1: the fake serves likes page by page like the real server.
import { afterEach, expect, test, vi } from "vitest";
import { createFakeBluesky } from "../fake-bluesky";
import { walkListRecords } from "./list-records.contract";
import { walkRejectedWrites, walkWrites } from "./write.contract";

const DID = "did:plc:fakeaccount000000000000";
const BASE_URL = "https://fake-bluesky.test";
const APP_PASSWORD = "fake-app-password";

afterEach(() => {
  vi.restoreAllMocks();
});

test("fake Bluesky serves 3 likes at limit 2 as pages of 2, 1 and 0 like the real server", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const likes = ["a", "b", "c"].map((name) =>
    bluesky.addLike({
      subject: bluesky.addPost(`post ${name}`).uri,
      createdAt: `2025-01-0${name.charCodeAt(0) - 96}T00:00:00.000Z`,
    }),
  );
  bluesky.intercept();

  const pages = await walkListRecords({ baseUrl: BASE_URL, did: DID, limit: 2 });

  expect(pages.map((page) => page.length)).toStrictEqual([2, 1, 0]);
  expect(
    pages
      .flat()
      .map((record) => record.uri)
      .sort(),
  ).toStrictEqual(likes.map((like) => like.uri).sort());
  expect(bluesky.requests()).toHaveLength(3);
  expect(
    bluesky.requests().map(({ method, url }) => [method, new URL(url).pathname]),
  ).toStrictEqual(Array(3).fill(["GET", "/xrpc/com.atproto.repo.listRecords"]));
});

test("fake Bluesky logs in and deletes likes in batches of at most 200 like the real server", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
  const [first, second, third] = ["a", "b", "c"].map((name) =>
    bluesky.addLike({
      subject: bluesky.addPost(`post ${name}`).uri,
      createdAt: `2025-01-0${name.charCodeAt(0) - 96}T00:00:00.000Z`,
    }),
  );
  bluesky.intercept();

  const { afterDelete } = await walkWrites({
    baseUrl: BASE_URL,
    did: DID,
    appPassword: APP_PASSWORD,
    likeUris: [first.uri, second.uri, third.uri],
  });

  expect(afterDelete).toStrictEqual([third.uri]);
  expect(bluesky.likes().map((like) => like.uri)).toStrictEqual([third.uri]);
});

test("fake Bluesky refuses applyWrites that carry anything but deletes of likes and applies nothing", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
  const [first, second, third] = ["a", "b", "c"].map((name) =>
    bluesky.addLike({
      subject: bluesky.addPost(`post ${name}`).uri,
      createdAt: `2025-01-0${name.charCodeAt(0) - 96}T00:00:00.000Z`,
    }),
  );
  bluesky.intercept();

  await walkRejectedWrites({
    baseUrl: BASE_URL,
    did: DID,
    appPassword: APP_PASSWORD,
    likeUris: [first.uri, second.uri, third.uri],
  });

  expect(bluesky.likes().map((like) => like.uri)).toStrictEqual([first.uri, second.uri, third.uri]);
});

function seedPost(bluesky: ReturnType<typeof createFakeBluesky>) {
  return bluesky.addPost("quoted post").uri;
}

test("fake Bluesky serves 150 reposts as pages of 100, 50 and 0, each non-empty page with a cursor", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const subject = seedPost(bluesky);
  const reposts = Array.from({ length: 150 }, () =>
    bluesky.addRepost({ subject, createdAt: "2025-01-01T00:00:00.000Z" }),
  );
  bluesky.intercept();

  const pages = await walkListRecords({
    baseUrl: BASE_URL,
    did: DID,
    limit: 100,
    collection: "app.bsky.feed.repost",
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
  bluesky.intercept();

  const pages = await walkListRecords({
    baseUrl: BASE_URL,
    did: DID,
    limit: 100,
    collection: "app.bsky.feed.repost",
  });

  expect(pages.flat().map((record) => record.value.via?.uri)).toStrictEqual([via]);
});

test("fake Bluesky deletes 2 of 3 reposts with applyWrites and lists only the third", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
  const subject = seedPost(bluesky);
  const [first, second, third] = [1, 2, 3].map((day) =>
    bluesky.addRepost({ subject, createdAt: `2025-01-0${day}T00:00:00.000Z` }),
  );
  bluesky.intercept();

  const { afterDelete } = await walkWrites({
    baseUrl: BASE_URL,
    did: DID,
    appPassword: APP_PASSWORD,
    collection: "app.bsky.feed.repost",
    likeUris: [first.uri, second.uri, third.uri],
  });

  expect(afterDelete).toStrictEqual([third.uri]);
  expect(bluesky.reposts().map((repost) => repost.uri)).toStrictEqual([third.uri]);
});

test("fake Bluesky holds a quote post with an app.bsky.embed.record embed and reads it back", () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const quoted = seedPost(bluesky);

  const quote = bluesky.addQuotePost({ quoted, createdAt: "2025-01-01T00:00:00.000Z" });

  expect(bluesky.quotePosts()).toStrictEqual([quote]);
  expect(quote.quoted).toBe(quoted);
});

test.each([
  [
    "a like",
    (bluesky: ReturnType<typeof createFakeBluesky>) =>
      bluesky.addLike({ subject: "not-an-at-uri", createdAt: "2025-01-01T00:00:00.000Z" }),
    "app.bsky.feed.like" as const,
  ],
  [
    "a repost",
    (bluesky: ReturnType<typeof createFakeBluesky>) =>
      bluesky.addRepost({ subject: "not-an-at-uri", createdAt: "2025-01-01T00:00:00.000Z" }),
    "app.bsky.feed.repost" as const,
  ],
])(
  "fake Bluesky refuses to serve %s that breaks its record lexicon",
  async (_name, add, collection) => {
    const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
    add(bluesky);
    bluesky.intercept();

    await expect(
      walkListRecords({ baseUrl: BASE_URL, did: DID, limit: 100, collection }),
    ).rejects.toThrow();
  },
);

async function listReposts() {
  const url = new URL("/xrpc/com.atproto.repo.listRecords", BASE_URL);
  url.searchParams.set("repo", DID);
  url.searchParams.set("collection", "app.bsky.feed.repost");
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

test.each([
  ["has no createdAt", undefined],
  ["has a createdAt that is not a date", "not-a-date"],
])("fake Bluesky serves a repost that %s as stored", async (_name, createdAt) => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });
  const subject = seedPost(bluesky);
  type NewRepost = Parameters<typeof bluesky.addRepost>[0];
  const repost = bluesky.addRepost({ subject, createdAt } as unknown as NewRepost);
  bluesky.intercept();

  await expect(listReposts()).resolves.toStrictEqual({
    status: 200,
    records: [{ uri: repost.uri, createdAt }],
  });
});

test("fake Bluesky refuses a quote post that breaks its record lexicon", () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL });

  expect(() =>
    bluesky.addQuotePost({ quoted: "not-an-at-uri", createdAt: "2025-01-01T00:00:00.000Z" }),
  ).toThrow();
});
