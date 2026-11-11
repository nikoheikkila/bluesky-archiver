// Feature: feature/delete-old-likes.feature
// Cycle 4: pick the likes older than one year.
import { expect, test } from "vitest";
import type { LikeRecord } from "../src/domain-types";
import { selectOldRecords } from "../src/select";
import { createdAgo, DAY, HOUR, RUN_START, YEAR } from "./constants";
import { recordOf } from "./records";

const like = (id: string, createdAt?: unknown) => recordOf("app.bsky.feed.like", id, createdAt);

test("selects the likes older than one year, oldest first, and skips those without a valid creation time", () => {
  const twoYears = like("a", createdAgo(2 * YEAR));
  const fourHundredDays = like("b", createdAgo(400 * DAY));
  const justOverAYear = like("c", createdAgo(YEAR + HOUR));
  const justUnderAYear = like("d", createdAgo(YEAR - HOUR));
  const yesterday = like("e", createdAgo(DAY));
  const withoutCreatedAt = like("f");
  const unparseable = like("g", "not-a-date");

  const result = selectOldRecords(
    [
      yesterday,
      twoYears,
      withoutCreatedAt,
      justOverAYear,
      unparseable,
      fourHundredDays,
      justUnderAYear,
    ],
    RUN_START,
  );

  expect(result.old.map((record) => record.uri)).toStrictEqual([
    twoYears.uri,
    fourHundredDays.uri,
    justOverAYear.uri,
  ]);
  expect(result.skipped).toBe(2);
});

test("does not select a like created exactly one year before the run starts", () => {
  const result = selectOldRecords([like("h", createdAgo(YEAR))], RUN_START);

  expect(result.old).toStrictEqual([]);
  expect(result.skipped).toBe(0);
});

test.each([
  { kind: "likes", collection: "app.bsky.feed.like" },
  { kind: "reposts", collection: "app.bsky.feed.repost" },
  { kind: "posts, whatever their kind", collection: "app.bsky.feed.post" },
] as const)("selects the $kind older than one year, oldest first", ({ collection }) => {
  const elections = recordOf(collection, "elections", createdAgo(2 * YEAR));
  const deletedPost = recordOf(collection, "deleted-post", createdAgo(400 * DAY));
  const football = recordOf(collection, "football", createdAgo(YEAR + HOUR));
  const cooking = recordOf(collection, "cooking", createdAgo(YEAR - HOUR));
  const music = recordOf(collection, "music", createdAgo(DAY));

  const result = selectOldRecords([music, football, elections, cooking, deletedPost], RUN_START);

  expect(result.old).toStrictEqual([elections, deletedPost, football]);
  expect(result.skipped).toBe(0);
});

test.each([
  { kind: "missing", createdAt: undefined },
  { kind: "the number 0", createdAt: 0 },
  { kind: "the number 2020", createdAt: 2020 },
  { kind: "an array holding a date", createdAt: ["2020-01-01T00:00:00Z"] },
  { kind: "true", createdAt: true },
  { kind: "null", createdAt: null },
  { kind: "an object", createdAt: {} },
])("skips and never selects a like whose createdAt is $kind, not a string", ({ createdAt }) => {
  const result = selectOldRecords([like("i", createdAt)], RUN_START);

  expect(result.old).toStrictEqual([]);
  expect(result.skipped).toBe(1);
});

test("skips and never selects a like that has no value", () => {
  const { uri, cid } = like("j", "2020-01-01T00:00:00Z");

  const result = selectOldRecords([{ uri, cid } as unknown as LikeRecord], RUN_START);

  expect(result.old).toStrictEqual([]);
  expect(result.skipped).toBe(1);
});
