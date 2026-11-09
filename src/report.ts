import type { SubjectRecord } from "./bluesky";

export interface DeletionSummary {
  found: number;
  deleted: number;
  skipped: number;
}

type Noun = "like" | "repost";

function plural(count: number, noun: Noun): string {
  return count === 1 ? noun : `${noun}s`;
}

export function formatRecordLine(record: SubjectRecord): string {
  return `${record.value.createdAt} ${record.value.subject.uri}`;
}

export const formatLikeLine = formatRecordLine;

export function formatDeletionSummary(
  { found, deleted, skipped }: DeletionSummary,
  noun: Noun = "like",
): string[] {
  const lines: string[] = [];
  if (skipped > 0) {
    lines.push(`Skipped ${skipped} ${plural(skipped, noun)} without a valid creation time`);
  }
  if (found === 0) {
    lines.push(`No ${noun}s are older than one year`);
  } else {
    lines.push(`Deleted ${deleted} of ${found} ${plural(found, noun)} older than one year`);
  }
  return lines;
}
