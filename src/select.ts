import type { DatedRecord, LikeRecord } from "./bluesky";

export interface Selection<T extends DatedRecord = LikeRecord> {
  old: T[];
  skipped: number;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

interface Dated<T> {
  record: T;
  time: number;
}

function parseCreatedAt(record: DatedRecord): number {
  // biome-ignore lint/suspicious/noUnnecessaryConditions: records from the network may lack a value
  const createdAt: unknown = record.value?.createdAt;
  return typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
}

function isDated<T>(entry: Dated<T>): boolean {
  return !Number.isNaN(entry.time);
}

function byOldestFirst<T>(a: Dated<T>, b: Dated<T>): number {
  return a.time - b.time;
}

export function selectOldRecords<T extends DatedRecord>(
  records: T[],
  runStart: number,
): Selection<T> {
  const cutoff = runStart - YEAR_MS;
  const dated = records.map((record) => ({ record, time: parseCreatedAt(record) })).filter(isDated);
  const old = dated
    .filter((entry) => entry.time < cutoff)
    .sort(byOldestFirst)
    .map((entry) => entry.record);
  return { old, skipped: records.length - dated.length };
}

export function selectOldLikes(likes: LikeRecord[], runStart: number): Selection {
  return selectOldRecords(likes, runStart);
}
