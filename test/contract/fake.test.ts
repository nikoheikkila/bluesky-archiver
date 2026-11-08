// Feature: feature/dry-run-old-likes.feature
// Cycle 1: the fake serves likes page by page like the real server.
import { afterEach, expect, test, vi } from "vitest";
import { createFakeBluesky } from "../fake-bluesky";
import { walkListRecords } from "./list-records.contract";

const DID = "did:plc:fakeaccount000000000000";
const BASE_URL = "https://fake-bluesky.test";

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
