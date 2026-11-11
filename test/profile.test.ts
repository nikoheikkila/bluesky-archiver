// Feature: feature/keep-pinned-post.feature (Test Case 8, readPinnedPost half)
import { expect, test } from "vitest";
import { readPinnedPost } from "../src/profile";
import { BASE_URL, DID } from "./constants";
import { createFakeBluesky } from "./fake-bluesky";
import { endlessBody } from "./streams";

const GET_RECORD_FAILED = "com.atproto.repo.getRecord failed with HTTP";

const newBluesky = () => createFakeBluesky();

type Bluesky = ReturnType<typeof newBluesky>;

function pinAPost(bluesky: Bluesky): string {
  const post = bluesky.addAccountPost({
    kind: "plain",
    text: "Pinned",
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  bluesky.pinPost(post);
  return post.uri;
}

test.each<{ name: string; arrange: (bluesky: Bluesky) => string | undefined; outcome: string }>([
  { name: "a pinned post", arrange: pinAPost, outcome: "its URI" },
  { name: "no profile", arrange: () => undefined, outcome: "nothing" },
  {
    name: "a profile without pinnedPost",
    arrange: (bluesky) => {
      bluesky.addProfileWithoutPin();
      return undefined;
    },
    outcome: "nothing",
  },
])("readPinnedPost with $name returns $outcome", async ({ arrange }) => {
  const bluesky = newBluesky();
  const expected = arrange(bluesky);

  const pinned = await readPinnedPost({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch });

  expect(pinned).toBe(expected);
});

test("readPinnedPost returns the URI passed to pinPost, not the cid or the DID", async () => {
  const bluesky = newBluesky();
  const post = bluesky.addAccountPost({
    kind: "plain",
    text: "Pinned",
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  bluesky.pinPost(post, { cid: "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae" });

  const pinned = await readPinnedPost({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch });

  expect(pinned).toBe(post.uri);
});

test.each([
  { status: 500, reason: "an HTTP 500" },
  { status: 400, reason: "an HTTP 400 other than RecordNotFound" },
])("readPinnedPost rejects on $reason", async ({ status }) => {
  const bluesky = newBluesky();
  bluesky.failProfileRead({ status });

  const reading = readPinnedPost({ baseUrl: BASE_URL, did: DID, fetch: bluesky.fetch });

  await expect(reading).rejects.toThrow(new Error(`${GET_RECORD_FAILED} ${status}`));
});

test.each([
  {
    name: "an HTTP 500 whose body says RecordNotFound",
    respond: async () =>
      Response.json(
        { error: "RecordNotFound", message: "Could not locate record" },
        { status: 500 },
      ),
  },
  { name: "an HTTP 500 with no body", respond: async () => new Response(null, { status: 500 }) },
])("readPinnedPost rejects on $name", async ({ respond }) => {
  const reading = readPinnedPost({ baseUrl: BASE_URL, did: DID, fetch: respond });

  await expect(reading).rejects.toThrow(new Error(`${GET_RECORD_FAILED} 500`));
});

test.each<{ name: string; respond: () => Promise<Response> }>([
  {
    name: "has no error field",
    respond: async () => Response.json({ message: "Could not locate record" }, { status: 400 }),
  },
  {
    name: "is not JSON",
    respond: async () => new Response("not json", { status: 400 }),
  },
  {
    name: "is the JSON value null",
    respond: async () => new Response("null", { status: 400 }),
  },
])("readPinnedPost rejects with the HTTP 400 message when the body $name", async ({ respond }) => {
  const reading = readPinnedPost({ baseUrl: BASE_URL, did: DID, fetch: respond });

  await expect(reading).rejects.toThrow(new Error(`${GET_RECORD_FAILED} 400`));
});

test("readPinnedPost cancels the unread body of an HTTP 500 before rejecting", async () => {
  const cancelled: unknown[] = [];
  const serverError = async () => new Response(endlessBody(cancelled), { status: 500 });

  const reading = readPinnedPost({ baseUrl: BASE_URL, did: DID, fetch: serverError });

  await expect(reading).rejects.toThrow(new Error(`${GET_RECORD_FAILED} 500`));
  expect(cancelled).toHaveLength(1);
});

test("readPinnedPost sends one unauthenticated GET getRecord for the profile", async () => {
  const bluesky = newBluesky();
  const captured: Request[] = [];
  const capturingFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push(new Request(input, init));
    return bluesky.fetch(input, init);
  };

  await readPinnedPost({ baseUrl: BASE_URL, did: DID, fetch: capturingFetch });

  expect(
    captured.map((request) => {
      const url = new URL(request.url);
      return {
        method: request.method,
        pathname: url.pathname,
        params: Object.fromEntries(url.searchParams),
        authorization: request.headers.get("Authorization"),
      };
    }),
  ).toStrictEqual([
    {
      method: "GET",
      pathname: "/xrpc/com.atproto.repo.getRecord",
      params: { repo: DID, collection: "app.bsky.actor.profile", rkey: "self" },
      authorization: null,
    },
  ]);
});

test("readPinnedPost rejects with the HTTP 500 message when cancelling the unread body fails", async () => {
  const body = new ReadableStream({
    cancel() {
      return Promise.reject(new Error("cancel failed"));
    },
  });
  const serverError = async () => new Response(body, { status: 500 });

  const reading = readPinnedPost({ baseUrl: BASE_URL, did: DID, fetch: serverError });

  await expect(reading).rejects.toThrow(new Error(`${GET_RECORD_FAILED} 500`));
});

test.each([
  { name: "TimeoutError", error: new DOMException("The operation timed out", "TimeoutError") },
  { name: "AbortError", error: new DOMException("The operation was aborted", "AbortError") },
])("readPinnedPost propagates a $name raised while reading an HTTP 400 body", async ({ error }) => {
  const body = new ReadableStream({
    start(controller) {
      controller.error(error);
    },
  });
  const failingBody = async () => new Response(body, { status: 400 });

  const reading = readPinnedPost({ baseUrl: BASE_URL, did: DID, fetch: failingBody });

  await expect(reading).rejects.toBe(error);
});
