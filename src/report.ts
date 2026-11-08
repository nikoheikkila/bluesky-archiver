import type { Selection } from "./select";

export function formatReport({ old, skipped }: Selection): string[] {
  const lines = old.map((like) => `${like.value.createdAt} ${like.value.subject.uri}`);
  if (skipped > 0) {
    const likes = skipped === 1 ? "1 like" : `${skipped} likes`;
    lines.push(`Skipped ${likes} without a valid creation time.`);
  }
  lines.push(totalLine(old.length));
  return lines;
}

function totalLine(count: number): string {
  if (count === 0) return "No likes are older than one year.";
  const likes = count === 1 ? "1 like is" : `${count} likes are`;
  return `${likes} older than one year and would be deleted.`;
}
