import type { DatedRecord } from "./domain-types";

export interface Selection<T extends DatedRecord> {
  old: T[];
  skipped: number;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function parseCreatedAt(record: DatedRecord): number {
  // biome-ignore lint/suspicious/noUnnecessaryConditions: records from the network may lack a value
  const createdAt: unknown = record.value?.createdAt;
  return typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
}

/** The records strictly older than one year before `runStart`, oldest first. */
export function selectOldRecords<T extends DatedRecord>(
  records: T[],
  runStart: number,
): Selection<T> {
  const cutoff = runStart - YEAR_MS;
  const old: { record: T; time: number }[] = [];
  let skipped = 0;
  for (const record of records) {
    const time = parseCreatedAt(record);
    if (Number.isNaN(time)) {
      skipped++;
    } else if (time < cutoff) {
      old.push({ record, time });
    }
  }
  old.sort((a, b) => a.time - b.time);
  return { old: old.map((entry) => entry.record), skipped };
}
