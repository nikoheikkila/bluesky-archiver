// Feature: feature/delete-old-likes.feature
// Cycle 5: format the report.
import { expect, test } from "vitest";
import { recordEntry, summaryEntries } from "../src/report";
import { DID } from "./constants";
import { recordOf } from "./records";

// Reply settings and quote settings have one form for both counts.
const nouns = [
  { noun: "like", collection: "app.bsky.feed.like", one: "like", many: "likes" },
  { noun: "repost", collection: "app.bsky.feed.repost", one: "repost", many: "reposts" },
  { noun: "post", collection: "app.bsky.feed.post", one: "post", many: "posts" },
  {
    noun: "reply settings",
    collection: "app.bsky.feed.threadgate",
    one: "reply settings",
    many: "reply settings",
  },
  {
    noun: "quote settings",
    collection: "app.bsky.feed.postgate",
    one: "quote settings",
    many: "quote settings",
  },
] as const;

test.each(
  nouns.flatMap(({ noun, collection }) =>
    ["1", "2"].map((id) => ({
      noun,
      collection,
      id,
      expected: `deleting ${noun} at://${DID}/${collection}/${id}`,
    })),
  ),
)("formats $noun $id as a record line with its own URI", ({ noun, collection, id, expected }) => {
  expect(recordEntry(recordOf(collection, id), noun).message).toStrictEqual(expected);
});

test.each(
  nouns.flatMap(({ noun, one, many }) => [
    {
      name: `${noun}: all three deleted`,
      noun,
      summary: { found: 3, deleted: 3, skipped: 0 },
      expected: [`Deleted 3 of 3 ${many} older than one year`],
    },
    {
      name: `${noun}: one deleted`,
      noun,
      summary: { found: 1, deleted: 1, skipped: 0 },
      expected: [`Deleted 1 of 1 ${one} older than one year`],
    },
    {
      name: `${noun}: none old`,
      noun,
      summary: { found: 0, deleted: 0, skipped: 0 },
      expected: [`No ${many} are older than one year`],
    },
    {
      name: `${noun}: one old and two skipped`,
      noun,
      summary: { found: 1, deleted: 1, skipped: 2 },
      expected: [
        `Skipped 2 ${many} without a valid creation time`,
        `Deleted 1 of 1 ${one} older than one year`,
      ],
    },
    {
      name: `${noun}: one old and one skipped`,
      noun,
      summary: { found: 1, deleted: 1, skipped: 1 },
      expected: [
        `Skipped 1 ${one} without a valid creation time`,
        `Deleted 1 of 1 ${one} older than one year`,
      ],
    },
  ]),
)("formats the deletion summary for $name", ({ summary, noun, expected }) => {
  expect(summaryEntries(summary, noun).map((entry) => entry.message)).toStrictEqual(expected);
});

// Workers best practice: structured logs carry the same facts as fields.
test("gives a deleted record's line its URI and kind as fields", () => {
  const repost = recordOf("app.bsky.feed.repost", "3");

  expect(recordEntry(repost, "repost")).toStrictEqual({
    message: `deleting repost ${repost.uri}`,
    fields: { event: "record_deleted", kind: "repost", uri: repost.uri },
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
