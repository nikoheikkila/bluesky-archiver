// Feature: feature/dry-run-old-likes.feature
// Cycle 4: pick the likes older than one year.
import { expect, test } from "vitest";
import type { LikeRecord } from "../src/bluesky";
import { selectOldLikes } from "../src/select";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const YEAR = 365 * DAY;

function likeCreatedAt(id: string, createdAt: string): LikeRecord {
  const uri = `at://did:plc:fakeaccount000000000000/app.bsky.feed.like/${id}`;
  const subject = { uri: `at://did:plc:someoneelse0000000000000/app.bsky.feed.post/${id}`, cid: `cid-${id}` };
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
    [yesterday, twoYears, withoutCreatedAt as unknown as LikeRecord, justOverAYear, unparseable, fourHundredDays, justUnderAYear],
    runStart,
  );

  expect(result.old.map((like) => like.uri)).toStrictEqual([twoYears.uri, fourHundredDays.uri, justOverAYear.uri]);
  expect(result.skipped).toBe(2);
});

test("does not select a like created exactly one year before the run starts", () => {
  const runStart = Date.parse("2026-11-08T03:00:00Z");
  const exactlyAYear = likeCreatedAt("h", new Date(runStart - YEAR).toISOString());

  const result = selectOldLikes([exactlyAYear], runStart);

  expect(result.old).toStrictEqual([]);
  expect(result.skipped).toBe(0);
});
