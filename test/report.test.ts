// Feature: feature/delete-old-likes.feature
// Cycle 5: format the report.
import { expect, test } from "vitest";
import type { DatedRecordOf, LikeRecord, RepostRecord } from "../src/domain-types";
import {
  formatDeletionSummary,
  formatLikeLine,
  formatRecordLine,
  recordEntry,
  summaryEntries,
} from "../src/report";

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

const firstLine = "deleting like at://did:plc:fakeaccount000000000000/app.bsky.feed.like/1";
const secondLine = "deleting like at://did:plc:fakeaccount000000000000/app.bsky.feed.like/2";

const firstRepost = repost("3", "2024-03-01T00:00:00.000Z");
const firstRepostLine =
  "deleting repost at://did:plc:fakeaccount000000000000/app.bsky.feed.repost/3";

// Cycle 4: format the deletion report.
test.each([
  { name: "first like", subject: first, expected: firstLine },
  { name: "second like", subject: second, expected: secondLine },
])("formats the $name as a deletion report line", ({ subject, expected }) => {
  expect(formatLikeLine(subject)).toStrictEqual(expected);
});

test.each([
  { name: "like", subject: first, noun: "like" as const, expected: firstLine },
  { name: "repost", subject: firstRepost, noun: "repost" as const, expected: firstRepostLine },
])("formats the $name as a record line", ({ subject, noun, expected }) => {
  expect(formatRecordLine(subject, noun)).toStrictEqual(expected);
  expect(formatRecordLine(subject, noun).endsWith(".")).toBe(false);
});

test("formats a record line as a like when no noun is given", () => {
  expect(formatRecordLine(first)).toStrictEqual(firstLine);
});

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

function dated<C extends string>(collection: C, id: string): DatedRecordOf<C> {
  return {
    uri: `at://did:plc:fakeaccount000000000000/${collection}/${id}`,
    cid: `${collection}-cid-${id}`,
    value: { $type: collection, createdAt: "2024-04-01T00:00:00.000Z" },
  };
}

// Feature: feature/delete-old-posts.feature
// Cycle 4: report lines for posts, reply settings and quote settings.
test.each([
  {
    name: "post",
    subject: dated("app.bsky.feed.post", "4"),
    noun: "post" as const,
    expected: "deleting post at://did:plc:fakeaccount000000000000/app.bsky.feed.post/4",
  },
  {
    name: "reply settings",
    subject: dated("app.bsky.feed.threadgate", "5"),
    noun: "reply settings" as const,
    expected:
      "deleting reply settings at://did:plc:fakeaccount000000000000/app.bsky.feed.threadgate/5",
  },
  {
    name: "quote settings",
    subject: dated("app.bsky.feed.postgate", "6"),
    noun: "quote settings" as const,
    expected:
      "deleting quote settings at://did:plc:fakeaccount000000000000/app.bsky.feed.postgate/6",
  },
])("formats the $name as a record line with its own URI", ({ subject, noun, expected }) => {
  expect(formatRecordLine(subject, noun)).toStrictEqual(expected);
  expect(formatRecordLine(subject, noun).endsWith(".")).toBe(false);
});

const newKindSummaries = [
  {
    name: "all three posts deleted",
    noun: "post" as const,
    summary: { found: 3, deleted: 3, skipped: 0 },
    expected: ["Deleted 3 of 3 posts older than one year"],
  },
  {
    name: "one post deleted",
    noun: "post" as const,
    summary: { found: 1, deleted: 1, skipped: 0 },
    expected: ["Deleted 1 of 1 post older than one year"],
  },
  {
    name: "no old posts",
    noun: "post" as const,
    summary: { found: 0, deleted: 0, skipped: 0 },
    expected: ["No posts are older than one year"],
  },
  {
    name: "one old post and two skipped",
    noun: "post" as const,
    summary: { found: 1, deleted: 1, skipped: 2 },
    expected: [
      "Skipped 2 posts without a valid creation time",
      "Deleted 1 of 1 post older than one year",
    ],
  },
  {
    name: "one old post and one skipped",
    noun: "post" as const,
    summary: { found: 1, deleted: 1, skipped: 1 },
    expected: [
      "Skipped 1 post without a valid creation time",
      "Deleted 1 of 1 post older than one year",
    ],
  },
  {
    name: "one reply settings deleted",
    noun: "reply settings" as const,
    summary: { found: 1, deleted: 1, skipped: 0 },
    expected: ["Deleted 1 of 1 reply settings older than one year"],
  },
  {
    name: "two reply settings deleted",
    noun: "reply settings" as const,
    summary: { found: 2, deleted: 2, skipped: 0 },
    expected: ["Deleted 2 of 2 reply settings older than one year"],
  },
  {
    name: "no old reply settings",
    noun: "reply settings" as const,
    summary: { found: 0, deleted: 0, skipped: 0 },
    expected: ["No reply settings are older than one year"],
  },
  {
    name: "one old reply settings and two skipped",
    noun: "reply settings" as const,
    summary: { found: 1, deleted: 1, skipped: 2 },
    expected: [
      "Skipped 2 reply settings without a valid creation time",
      "Deleted 1 of 1 reply settings older than one year",
    ],
  },
  {
    name: "one old reply settings and one skipped",
    noun: "reply settings" as const,
    summary: { found: 1, deleted: 1, skipped: 1 },
    expected: [
      "Skipped 1 reply settings without a valid creation time",
      "Deleted 1 of 1 reply settings older than one year",
    ],
  },
  {
    name: "one quote settings deleted",
    noun: "quote settings" as const,
    summary: { found: 1, deleted: 1, skipped: 0 },
    expected: ["Deleted 1 of 1 quote settings older than one year"],
  },
  {
    name: "three quote settings deleted",
    noun: "quote settings" as const,
    summary: { found: 3, deleted: 3, skipped: 0 },
    expected: ["Deleted 3 of 3 quote settings older than one year"],
  },
  {
    name: "no old quote settings",
    noun: "quote settings" as const,
    summary: { found: 0, deleted: 0, skipped: 0 },
    expected: ["No quote settings are older than one year"],
  },
  {
    name: "one old quote settings and three skipped",
    noun: "quote settings" as const,
    summary: { found: 1, deleted: 1, skipped: 3 },
    expected: [
      "Skipped 3 quote settings without a valid creation time",
      "Deleted 1 of 1 quote settings older than one year",
    ],
  },
];

test.each(newKindSummaries)(
  "formats the deletion summary for $name",
  ({ summary, noun, expected }) => {
    expect(formatDeletionSummary(summary, noun)).toStrictEqual(expected);
  },
);

test.each(newKindSummaries)(
  "ends no deletion summary line with a period for $name",
  ({ summary, noun, expected }) => {
    const lines = formatDeletionSummary(summary, noun);

    expect(lines).toHaveLength(expected.length);
    expect(lines.filter((line) => line.endsWith("."))).toStrictEqual([]);
  },
);

// Workers best practice: structured logs carry the same facts as fields.
test("gives a deleted record's line its URI and kind as fields", () => {
  expect(recordEntry(firstRepost, "repost")).toStrictEqual({
    message: firstRepostLine,
    fields: { event: "record_deleted", kind: "repost", uri: firstRepost.uri },
  });
});

test("gives the skipped line and the summary line their counts as fields", () => {
  expect(summaryEntries({ found: 3, deleted: 2, skipped: 1 }, "post")).toStrictEqual([
    {
      message: "Skipped 1 post without a valid creation time",
      fields: { event: "records_skipped", kind: "post", skipped: 1 },
    },
    {
      message: "Deleted 2 of 3 posts older than one year",
      fields: { event: "kind_summary", kind: "post", found: 3, deleted: 2, skipped: 1 },
    },
  ]);
});

test("gives a kind with nothing old one summary line with zero counts", () => {
  expect(summaryEntries({ found: 0, deleted: 0, skipped: 0 }, "reply settings")).toStrictEqual([
    {
      message: "No reply settings are older than one year",
      fields: { event: "kind_summary", kind: "reply settings", found: 0, deleted: 0, skipped: 0 },
    },
  ]);
});
