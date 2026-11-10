// Type-only: emits nothing at runtime.
export interface SubjectRecordOf<C extends string> {
  uri: string;
  cid: string;
  value: {
    $type: C;
    subject: { uri: string; cid: string };
    createdAt: string;
  };
}

export type LikeRecord = SubjectRecordOf<"app.bsky.feed.like">;
export type RepostRecord = SubjectRecordOf<"app.bsky.feed.repost">;
export type SubjectRecord = LikeRecord | RepostRecord;

export interface DatedRecordOf<C extends string = string> {
  uri: string;
  cid: string;
  value: { $type: C; createdAt: string };
}
export type DatedRecord = DatedRecordOf;

export type Collection =
  | SubjectRecord["value"]["$type"]
  | "app.bsky.feed.post"
  | "app.bsky.feed.threadgate"
  | "app.bsky.feed.postgate";
export type RecordIn<C extends Collection> = [C] extends [
  Exclude<Collection, SubjectRecord["value"]["$type"]>,
]
  ? DatedRecordOf<C>
  : Extract<SubjectRecord, { value: { $type: C } }>;
