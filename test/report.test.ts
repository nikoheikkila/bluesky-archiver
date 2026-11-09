// Feature: feature/delete-old-likes.feature
// Cycle 5: format the report.
import { expect, test } from "vitest";
import type { LikeRecord, RepostRecord } from "../src/bluesky";
import { formatDeletionSummary, formatLikeLine, formatRecordLine } from "../src/report";

function like(id: string, createdAt: string): LikeRecord {
  const uri = `at://did:plc:fakeaccount000000000000/app.bsky.feed.like/${id}`;
  const subject = {
    uri: `at://did:plc:someoneelse0000000000000/app.bsky.feed.post/${id}`,
    cid: `cid-${id}`,
  };
  return { uri, cid: `like-cid-${id}`, value: { $type: "app.bsky.feed.like", subject, createdAt } };
}

function repost(id: string, createdAt: string): RepostRecord {
  const uri = `at://did:plc:fakeaccount000000000000/app.bsky.feed.repost/${id}`;
  const subject = {
    uri: `at://did:plc:someoneelse0000000000000/app.bsky.feed.post/${id}`,
    cid: `cid-${id}`,
  };
  return {
    uri,
    cid: `repost-cid-${id}`,
    value: { $type: "app.bsky.feed.repost", subject, createdAt },
  };
}

const first = like("1", "2024-01-01T00:00:00.000Z");
const second = like("2", "2024-02-01T00:00:00.000Z");

const firstLine =
  "2024-01-01T00:00:00.000Z at://did:plc:someoneelse0000000000000/app.bsky.feed.post/1";
const secondLine =
  "2024-02-01T00:00:00.000Z at://did:plc:someoneelse0000000000000/app.bsky.feed.post/2";

const firstRepost = repost("3", "2024-03-01T00:00:00.000Z");
const firstRepostLine =
  "2024-03-01T00:00:00.000Z at://did:plc:someoneelse0000000000000/app.bsky.feed.post/3";

// Cycle 4: format the deletion report.
test.each([
  { name: "first like", subject: first, expected: firstLine },
  { name: "second like", subject: second, expected: secondLine },
])("formats the $name as a deletion report line", ({ subject, expected }) => {
  expect(formatLikeLine(subject)).toStrictEqual(expected);
});

test.each([{ name: "repost", subject: firstRepost, expected: firstRepostLine }])(
  "formats the $name as a record line",
  ({ subject, expected }) => {
    expect(formatRecordLine(subject)).toStrictEqual(expected);
    expect(formatRecordLine(subject).endsWith(".")).toBe(false);
  },
);

const deletionSummaries = [
  {
    name: "all three likes deleted",
    summary: { found: 3, deleted: 3, skipped: 0 },
    expected: ["Deleted 3 of 3 likes older than one year"],
  },
  {
    name: "one like deleted",
    summary: { found: 1, deleted: 1, skipped: 0 },
    expected: ["Deleted 1 of 1 like older than one year"],
  },
  {
    name: "no old likes",
    summary: { found: 0, deleted: 0, skipped: 0 },
    expected: ["No likes are older than one year"],
  },
  {
    name: "one old like and two skipped",
    summary: { found: 1, deleted: 1, skipped: 2 },
    expected: [
      "Skipped 2 likes without a valid creation time",
      "Deleted 1 of 1 like older than one year",
    ],
  },
  {
    name: "one old like and one skipped",
    summary: { found: 1, deleted: 1, skipped: 1 },
    expected: [
      "Skipped 1 like without a valid creation time",
      "Deleted 1 of 1 like older than one year",
    ],
  },
];

test.each(deletionSummaries)("formats the deletion summary for $name", ({ summary, expected }) => {
  expect(formatDeletionSummary(summary)).toStrictEqual(expected);
});

const repostSummaries = [
  {
    name: "all three reposts deleted",
    summary: { found: 3, deleted: 3, skipped: 0 },
    expected: ["Deleted 3 of 3 reposts older than one year"],
  },
  {
    name: "one repost deleted",
    summary: { found: 1, deleted: 1, skipped: 0 },
    expected: ["Deleted 1 of 1 repost older than one year"],
  },
  {
    name: "no old reposts",
    summary: { found: 0, deleted: 0, skipped: 0 },
    expected: ["No reposts are older than one year"],
  },
  {
    name: "one old repost and two skipped",
    summary: { found: 1, deleted: 1, skipped: 2 },
    expected: [
      "Skipped 2 reposts without a valid creation time",
      "Deleted 1 of 1 repost older than one year",
    ],
  },
  {
    name: "one old repost and one skipped",
    summary: { found: 1, deleted: 1, skipped: 1 },
    expected: [
      "Skipped 1 repost without a valid creation time",
      "Deleted 1 of 1 repost older than one year",
    ],
  },
];

test.each(repostSummaries)(
  "formats the repost deletion summary for $name",
  ({ summary, expected }) => {
    expect(formatDeletionSummary(summary, "repost")).toStrictEqual(expected);
  },
);

test.each(deletionSummaries)(
  "ends no deletion summary line with a period for $name",
  ({ summary, expected }) => {
    const lines = formatDeletionSummary(summary);

    expect(lines).toHaveLength(expected.length);
    expect(lines.filter((line) => line.endsWith("."))).toStrictEqual([]);
  },
);

test.each(repostSummaries)(
  "ends no repost deletion summary line with a period for $name",
  ({ summary, expected }) => {
    const lines = formatDeletionSummary(summary, "repost");

    expect(lines).toStrictEqual(expected);
    expect(lines.filter((line) => line.endsWith("."))).toStrictEqual([]);
  },
);
