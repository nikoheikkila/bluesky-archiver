import type { LikeRecord } from "./bluesky";

function skippedLine(skipped: number): string {
  const likes = skipped === 1 ? "1 like" : `${skipped} likes`;
  return `Skipped ${likes} without a valid creation time`;
}

export interface DeletionSummary {
  found: number;
  deleted: number;
  skipped: number;
}

export function formatLikeLine(like: LikeRecord): string {
  return `${like.value.createdAt} ${like.value.subject.uri}`;
}

export function formatDeletionSummary({ found, deleted, skipped }: DeletionSummary): string[] {
  const lines: string[] = [];
  if (skipped > 0) lines.push(skippedLine(skipped));
  if (found === 0) {
    lines.push("No likes are older than one year");
  } else {
    const noun = found === 1 ? "like" : "likes";
    lines.push(`Deleted ${deleted} of ${found} ${noun} older than one year`);
  }
  return lines;
}
