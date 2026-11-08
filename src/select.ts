import type { LikeRecord } from "./bluesky";

export interface Selection {
  old: LikeRecord[];
  skipped: number;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

interface DatedLike {
  like: LikeRecord;
  time: number;
}

function parseCreatedAt(like: LikeRecord): number {
  const createdAt: unknown = like.value?.createdAt;
  return typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
}

function withTime(like: LikeRecord): DatedLike {
  return { like, time: parseCreatedAt(like) };
}

function isDated(entry: DatedLike): boolean {
  return !Number.isNaN(entry.time);
}

function byOldestFirst(a: DatedLike, b: DatedLike): number {
  return a.time - b.time;
}

export function selectOldLikes(likes: LikeRecord[], runStart: number): Selection {
  const cutoff = runStart - YEAR_MS;
  const dated = likes.map(withTime).filter(isDated);
  const old = dated
    .filter((entry) => entry.time < cutoff)
    .sort(byOldestFirst)
    .map((entry) => entry.like);
  return { old, skipped: likes.length - dated.length };
}
