import type { Fetch } from "./bluesky";

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
    const body = (await response.json()) as ProfileBody;
    // Stryker disable next-line OptionalChaining: getRecord requires value, so it is never undefined.
    return body.value?.pinnedPost?.uri;
  }
  if (response.status === 400 && (await isRecordNotFound(response))) {
    return undefined;
  }
  // An unread body is cancelled so the Workers runtime releases the connection.
  if (!response.bodyUsed) {
    await response.body?.cancel().catch(() => undefined);
  }
  throw new Error(`${GET_RECORD} failed with HTTP ${response.status}`);
}

async function isRecordNotFound(response: Response): Promise<boolean> {
  const body = (await response.json().catch(treatUnparseableAsEmpty)) as ErrorBody | null;
  return body?.error === "RecordNotFound";
}

// Only a body that is not JSON means "not RecordNotFound"; a failed read must still fail the run.
function treatUnparseableAsEmpty(error: unknown): ErrorBody {
  if (error instanceof SyntaxError) {
    return {};
  }
  throw error;
}
