import type { Collection, RecordIn } from "../src/domain-types";
import { CID, DID } from "./constants";

/**
 * A record of `collection` with a deterministic URI and CID. It always carries a subject, which
 * kinds without one ignore. `createdAt` is `unknown` so tests can pass malformed or missing values.
 */
export function recordOf<C extends Collection>(
  collection: C,
  id: string,
  createdAt?: unknown,
): RecordIn<C> {
  const subject = {
    uri: `at://did:plc:someoneelse0000000000000/app.bsky.feed.post/${id}`,
    cid: CID,
  };
  return {
    uri: `at://${DID}/${collection}/${id}`,
    cid: `${collection}-cid-${id}`,
    value: { $type: collection, subject, createdAt },
  } as RecordIn<C>;
}
