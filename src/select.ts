import type { LikeRecord } from "./bluesky";

export interface Selection {
  old: LikeRecord[];
  skipped: number;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function selectOldLikes(likes: LikeRecord[], runStart: number): Selection {
  const cutoff = runStart - YEAR_MS;
  const entries: { like: LikeRecord; time: number }[] = [];
  let skipped = 0;
  for (const like of likes) {
    const createdAt: unknown = like.value?.createdAt;
    const time = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
    if (Number.isNaN(time)) {
      skipped++;
      continue;
    }
    if (time < cutoff) {
      entries.push({ like, time });
    }
  }
  entries.sort((a, b) => a.time - b.time);
  return { old: entries.map((entry) => entry.like), skipped };
}
