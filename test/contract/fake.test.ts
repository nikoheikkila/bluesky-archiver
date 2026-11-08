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
  expect(pages.flat().map((record) => record.uri).sort()).toStrictEqual(likes.map((like) => like.uri).sort());
  expect(bluesky.requests()).toHaveLength(3);
  expect(bluesky.requests().map(({ method, url }) => [method, new URL(url).pathname])).toStrictEqual(
    Array(3).fill(["GET", "/xrpc/com.atproto.repo.listRecords"]),
  );
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
