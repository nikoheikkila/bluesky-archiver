import type { DatedRecord } from "./domain-types";

export interface DeletionSummary {
  found: number;
  deleted: number;
  skipped: number;
}

/** The queryable fields of a report line; Workers Logs indexes each field of a JSON log line. */
type ReportFields =
  | { event: "record_deleted"; kind: RecordNoun; uri: string }
  | { event: "records_skipped"; kind: RecordNoun; skipped: number }
  | ({ event: "kind_summary"; kind: RecordNoun } & DeletionSummary);

/** A report line: the wording fixed by the spec, and the same facts as fields. */
export interface ReportEntry {
  message: string;
  fields: ReportFields;
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

export function recordEntry(record: DatedRecord, noun: RecordNoun): ReportEntry {
  return {
    message: `deleting ${noun} ${record.uri}`,
    fields: { event: "record_deleted", kind: noun, uri: record.uri },
  };
}

export function summaryEntries(summary: DeletionSummary, noun: RecordNoun): ReportEntry[] {
  const { found, deleted, skipped } = summary;
  const entries: ReportEntry[] = [];
  if (skipped > 0) {
    entries.push({
      message: `Skipped ${skipped} ${plural(skipped, noun)} without a valid creation time`,
      fields: { event: "records_skipped", kind: noun, skipped },
    });
  }
  entries.push({
    message:
      found === 0
        ? `No ${plural(found, noun)} are older than one year`
        : `Deleted ${deleted} of ${found} ${plural(found, noun)} older than one year`,
    fields: { event: "kind_summary", kind: noun, found, deleted, skipped },
  });
  return entries;
}
