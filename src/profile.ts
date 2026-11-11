import type { Fetch } from "./bluesky";
import { discardBody, readJson } from "./body";

const GET_RECORD = "com.atproto.repo.getRecord";
const PROFILE_COLLECTION = "app.bsky.actor.profile";

export interface ReadPinnedPostOptions {
  baseUrl: string;
  did: string;
  fetch: Fetch;
}

interface ErrorBody {
  error?: string;
}

interface ProfileBody {
  value?: { pinnedPost?: { uri: string } };
}

export async function readPinnedPost(options: ReadPinnedPostOptions): Promise<string | undefined> {
  const url = new URL(`/xrpc/${GET_RECORD}`, options.baseUrl);
  url.searchParams.set("repo", options.did);
  url.searchParams.set("collection", PROFILE_COLLECTION);
  url.searchParams.set("rkey", "self");
  const response = await options.fetch(url);
  if (response.ok) {
    const body = await readJson<ProfileBody>(response);
    // Stryker disable next-line OptionalChaining: getRecord requires value, so it is never undefined.
    return body.value?.pinnedPost?.uri;
  }
  if (response.status === 400 && (await isRecordNotFound(response))) {
    return undefined;
  }
  // A body readJson already read is left as it is; an unread one is cancelled.
  await discardBody(response);
  throw new Error(`${GET_RECORD} failed with HTTP ${response.status}`);
}

async function isRecordNotFound(response: Response): Promise<boolean> {
  const body = await readJson<ErrorBody | null>(response).catch(treatUnparseableAsEmpty);
  return body?.error === "RecordNotFound";
}

// Only a body that is not JSON means "not RecordNotFound"; a failed read must still fail the run.
function treatUnparseableAsEmpty(error: unknown): ErrorBody {
  if (error instanceof SyntaxError) {
    return {};
  }
  throw error;
}

export function withoutPinnedPost<R extends { uri: string }>(
  records: R[],
  pinnedUri: string | undefined,
): R[] {
  return records.filter((record) => record.uri !== pinnedUri);
}
