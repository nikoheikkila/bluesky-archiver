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
  value: { $type: C; createdAt?: string };
}
export type DatedRecord = DatedRecordOf;

interface RecordByCollection {
  "app.bsky.feed.like": LikeRecord;
  "app.bsky.feed.repost": RepostRecord;
  "app.bsky.feed.post": DatedRecordOf<"app.bsky.feed.post">;
  "app.bsky.feed.threadgate": DatedRecordOf<"app.bsky.feed.threadgate">;
  "app.bsky.feed.postgate": DatedRecordOf<"app.bsky.feed.postgate">;
}
export type Collection = keyof RecordByCollection;
export type RecordIn<C extends Collection> = RecordByCollection[C];
