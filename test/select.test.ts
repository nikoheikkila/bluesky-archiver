// Feature: feature/delete-old-likes.feature
// Cycle 4: pick the likes older than one year.
import { expect, test } from "vitest";
import type { LikeRecord, RepostRecord } from "../src/bluesky";
import { selectOldLikes, selectOldRecords } from "../src/select";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const YEAR = 365 * DAY;

function likeCreatedAt(id: string, createdAt: string): LikeRecord {
  const uri = `at://did:plc:fakeaccount000000000000/app.bsky.feed.like/${id}`;
  const subject = {
    uri: `at://did:plc:someoneelse0000000000000/app.bsky.feed.post/${id}`,
    cid: `cid-${id}`,
  };
  return { uri, cid: `like-cid-${id}`, value: { $type: "app.bsky.feed.like", subject, createdAt } };
}

test("selects the likes older than one year, oldest first, and skips those without a valid creation time", () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const ago = (ms: number) => new Date(runStart - ms).toISOString();
  const twoYears = likeCreatedAt("a", ago(2 * YEAR));
  const fourHundredDays = likeCreatedAt("b", ago(400 * DAY));
  const justOverAYear = likeCreatedAt("c", ago(YEAR + HOUR));
  const justUnderAYear = likeCreatedAt("d", ago(YEAR - HOUR));
  const yesterday = likeCreatedAt("e", ago(DAY));
  const withoutCreatedAt = likeCreatedAt("f", "") as unknown as { value: Record<string, unknown> };
  delete withoutCreatedAt.value.createdAt;
  const unparseable = likeCreatedAt("g", "not-a-date");

  const result = selectOldLikes(
    [
      yesterday,
      twoYears,
      withoutCreatedAt as unknown as LikeRecord,
      justOverAYear,
      unparseable,
      fourHundredDays,
      justUnderAYear,
    ],
    runStart,
  );

  expect(result.old.map((like) => like.uri)).toStrictEqual([
    twoYears.uri,
    fourHundredDays.uri,
    justOverAYear.uri,
  ]);
  expect(result.skipped).toBe(2);
});

test("does not select a like created exactly one year before the run starts", () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const exactlyAYear = likeCreatedAt("h", new Date(runStart - YEAR).toISOString());

  const result = selectOldLikes([exactlyAYear], runStart);

  expect(result.old).toStrictEqual([]);
  expect(result.skipped).toBe(0);
});

function recordCreatedAt(
  collection: "app.bsky.feed.like" | "app.bsky.feed.repost",
  id: string,
  createdAt: string,
): LikeRecord | RepostRecord {
  const subject = {
    uri: `at://did:plc:someoneelse0000000000000/app.bsky.feed.post/${id}`,
    cid: `cid-${id}`,
  };
  return {
    uri: `at://did:plc:fakeaccount000000000000/${collection}/${id}`,
    cid: `record-cid-${id}`,
    value: { $type: collection, subject, createdAt },
  } as LikeRecord | RepostRecord;
}

test.each([
  { kind: "likes", collection: "app.bsky.feed.like" },
  { kind: "reposts", collection: "app.bsky.feed.repost" },
] as const)("selects the $kind older than one year, oldest first", ({ collection }) => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const ago = (ms: number) => new Date(runStart - ms).toISOString();
  const elections = recordCreatedAt(collection, "elections", ago(2 * YEAR));
  const deletedPost = recordCreatedAt(collection, "deleted-post", ago(400 * DAY));
  const football = recordCreatedAt(collection, "football", ago(YEAR + HOUR));
  const cooking = recordCreatedAt(collection, "cooking", ago(YEAR - HOUR));
  const music = recordCreatedAt(collection, "music", ago(DAY));

  const result = selectOldRecords([music, football, elections, cooking, deletedPost], runStart);

  expect(result.old.map((record) => record.uri)).toStrictEqual([
    elections.uri,
    deletedPost.uri,
    football.uri,
  ]);
  expect(result.skipped).toBe(0);
});

test.each([
  { kind: "the number 0", createdAt: 0 },
  { kind: "the number 2020", createdAt: 2020 },
  { kind: "an array holding a date", createdAt: ["2020-01-01T00:00:00Z"] },
  { kind: "true", createdAt: true },
  { kind: "null", createdAt: null },
  { kind: "an object", createdAt: {} },
])("skips and never selects a like whose createdAt is $kind, not a string", ({ createdAt }) => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const notAString = likeCreatedAt("i", createdAt as unknown as string);

  const result = selectOldLikes([notAString], runStart);

  expect(result.old).toStrictEqual([]);
  expect(result.skipped).toBe(1);
});

test("skips and never selects a like that has no value", () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const { uri, cid } = likeCreatedAt("j", "2020-01-01T00:00:00Z");

  const result = selectOldLikes([{ uri, cid } as unknown as LikeRecord], runStart);

  expect(result.old).toStrictEqual([]);
  expect(result.skipped).toBe(1);
});
