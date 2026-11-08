// Feature: feature/dry-run-old-likes.feature
// Cycle 5: format the report.
import { expect, test } from "vitest";
import type { LikeRecord } from "../src/bluesky";
import { formatReport } from "../src/report";

function like(id: string, createdAt: string): LikeRecord {
  const uri = `at://did:plc:fakeaccount000000000000/app.bsky.feed.like/${id}`;
  const subject = { uri: `at://did:plc:someoneelse0000000000000/app.bsky.feed.post/${id}`, cid: `cid-${id}` };
  return { uri, cid: `like-cid-${id}`, value: { $type: "app.bsky.feed.like", subject, createdAt } };
}

const first = like("1", "2024-01-01T00:00:00.000Z");
const second = like("2", "2024-02-01T00:00:00.000Z");
const third = like("3", "2024-03-01T00:00:00.000Z");

const firstLine = "2024-01-01T00:00:00.000Z at://did:plc:someoneelse0000000000000/app.bsky.feed.post/1";
const secondLine = "2024-02-01T00:00:00.000Z at://did:plc:someoneelse0000000000000/app.bsky.feed.post/2";
const thirdLine = "2024-03-01T00:00:00.000Z at://did:plc:someoneelse0000000000000/app.bsky.feed.post/3";

test.each([
  {
    name: "three old likes",
    old: [first, second, third],
    skipped: 0,
    expected: [firstLine, secondLine, thirdLine, "3 likes are older than one year and would be deleted."],
  },
  {
    name: "one old like",
    old: [first],
    skipped: 0,
    expected: [firstLine, "1 like is older than one year and would be deleted."],
  },
  {
    name: "no old likes",
    old: [],
    skipped: 0,
    expected: ["No likes are older than one year."],
  },
  {
    name: "one old like and two skipped",
    old: [first],
    skipped: 2,
    expected: [
      firstLine,
      "Skipped 2 likes without a valid creation time.",
      "1 like is older than one year and would be deleted.",
    ],
  },
  {
    name: "one old like and one skipped",
    old: [first],
    skipped: 1,
    expected: [
      firstLine,
      "Skipped 1 like without a valid creation time.",
      "1 like is older than one year and would be deleted.",
    ],
  },
])("formats the report for $name", ({ old, skipped, expected }) => {
  expect(formatReport({ old, skipped })).toStrictEqual(expected);
});
