import type { DatedRecord } from "./bluesky";

export interface DeletionSummary {
  found: number;
  deleted: number;
  skipped: number;
}

export type RecordNoun = "like" | "repost" | "post" | "reply settings" | "quote settings";

const plurals: Record<RecordNoun, string> = {
  like: "likes",
  repost: "reposts",
  post: "posts",
  "reply settings": "reply settings",
  "quote settings": "quote settings",
};

function plural(count: number, noun: RecordNoun): string {
  return count === 1 ? noun : plurals[noun];
}

export function formatRecordLine(record: DatedRecord, noun: RecordNoun = "like"): string {
  return `deleting ${noun} ${record.uri}`;
}

export const formatLikeLine = formatRecordLine;

export function formatDeletionSummary(
  { found, deleted, skipped }: DeletionSummary,
  noun: RecordNoun = "like",
): string[] {
  const lines: string[] = [];
  if (skipped > 0) {
    lines.push(`Skipped ${skipped} ${plural(skipped, noun)} without a valid creation time`);
  }
  if (found === 0) {
    lines.push(`No ${plural(found, noun)} are older than one year`);
  } else {
    lines.push(`Deleted ${deleted} of ${found} ${plural(found, noun)} older than one year`);
  }
  return lines;
}
