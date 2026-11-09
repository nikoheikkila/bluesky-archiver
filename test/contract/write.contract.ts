// Shared contract for com.atproto.server.createSession and com.atproto.repo.applyWrites
// (deletes of app.bsky.feed.like and app.bsky.feed.repost). Holds for the fake; the default suite never sends it to the real server.
import { expect } from "vitest";
import type { Fetch } from "../../src/bluesky";
import { walkListRecords } from "./list-records.contract";

export interface WriteTarget {
  baseUrl: string;
  did: string;
  appPassword: string;
  /** URIs of exactly three records of `collection`, in this order. */
  likeUris: [string, string, string];
  fetch: Fetch;
  /** Defaults to app.bsky.feed.like. */
  collection?: "app.bsky.feed.like" | "app.bsky.feed.repost";
}

interface SessionResponse {
  accessJwt: string;
  refreshJwt: string;
  handle: string;
  did: string;
}

const MAX_WRITES = 200;

function rkeyOf(uri: string): string {
  return uri.split("/").at(-1) as string;
}

function deleteWrite(rkey: string, collection = "app.bsky.feed.like") {
  return { $type: "com.atproto.repo.applyWrites#delete", collection, rkey };
}

async function createSession(target: WriteTarget): Promise<SessionResponse> {
  const response = await target.fetch(
    new URL("/xrpc/com.atproto.server.createSession", target.baseUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: target.did, password: target.appPassword }),
    },
  );
  expect(response.status, "createSession with the DID and the right password status").toBe(200);
  const session = (await response.json()) as SessionResponse;
  expect(typeof session.accessJwt, "createSession returns an access token").toBe("string");
  expect(session.accessJwt.length, "the access token is not empty").toBeGreaterThan(0);
  return session;
}

async function applyWrites(
  target: WriteTarget,
  rkeys: string[],
  accessJwt?: string,
): Promise<Response> {
  return postWrites(
    target,
    rkeys.map((rkey) => deleteWrite(rkey, target.collection)),
    accessJwt,
  );
}

async function postWrites(
  target: WriteTarget,
  writes: object[],
  accessJwt?: string,
): Promise<Response> {
  return target.fetch(new URL("/xrpc/com.atproto.repo.applyWrites", target.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessJwt === undefined ? {} : { Authorization: `Bearer ${accessJwt}` }),
    },
    body: JSON.stringify({ repo: target.did, writes }),
  });
}

async function remainingLikeUris(target: WriteTarget): Promise<string[]> {
  const pages = await walkListRecords({
    baseUrl: target.baseUrl,
    did: target.did,
    limit: 100,
    collection: target.collection,
    fetch: target.fetch,
  });
  return pages.flat().map((record) => record.uri);
}

export async function walkWrites(target: WriteTarget): Promise<{ afterDelete: string[] }> {
  const [first, second, third] = target.likeUris;

  const session = await createSession(target);

  const deleted = await applyWrites(target, [rkeyOf(first), rkeyOf(second)], session.accessJwt);
  expect(deleted.status, "applyWrites deleting 2 of 3 likes status").toBe(200);
  const afterDelete = await remainingLikeUris(target);
  expect(afterDelete, "only the third like remains after deleting 2 of 3").toStrictEqual([third]);

  const tooMany = [
    rkeyOf(third),
    ...Array.from({ length: MAX_WRITES }, (_, index) => `absent${index}`),
  ];
  expect(tooMany.length, "the oversized batch exceeds the 200 writes limit").toBe(MAX_WRITES + 1);
  const oversized = await applyWrites(target, tooMany, session.accessJwt);
  expect(oversized.status, "applyWrites with 201 deletes status").toBe(400);
  expect(
    await remainingLikeUris(target),
    "nothing is deleted by the oversized batch",
  ).toStrictEqual([third]);

  const anonymous = await applyWrites(target, [rkeyOf(third)]);
  expect(anonymous.status, "applyWrites without a token status").toBe(401);
  expect(await remainingLikeUris(target), "nothing is deleted without a token").toStrictEqual([
    third,
  ]);

  return { afterDelete };
}

// Writes that are valid under the applyWrites lexicon but break the rule that applyWrites carries only
// deletes of app.bsky.feed.like. Each one travels together with a valid like delete.
export interface ForbiddenWrite {
  name: string;
  write(target: WriteTarget): object;
}

const LIKE_CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";

function likeValue(target: WriteTarget) {
  return {
    $type: "app.bsky.feed.like",
    subject: { uri: target.likeUris[1], cid: LIKE_CID },
    createdAt: "2025-01-01T00:00:00.000Z",
  };
}

export const FORBIDDEN_WRITES: ForbiddenWrite[] = [
  {
    name: "a create of app.bsky.feed.like",
    write: (target) => ({
      $type: "com.atproto.repo.applyWrites#create",
      collection: "app.bsky.feed.like",
      value: likeValue(target),
    }),
  },
  {
    name: "an update of app.bsky.feed.like",
    write: (target) => ({
      $type: "com.atproto.repo.applyWrites#update",
      collection: "app.bsky.feed.like",
      rkey: rkeyOf(target.likeUris[1]),
      value: likeValue(target),
    }),
  },
  {
    name: "a delete in app.bsky.feed.post",
    write: (target) => ({
      $type: "com.atproto.repo.applyWrites#delete",
      collection: "app.bsky.feed.post",
      rkey: rkeyOf(target.likeUris[1]),
    }),
  },
];

export async function walkRejectedWrite(
  target: WriteTarget,
  forbidden: ForbiddenWrite,
): Promise<void> {
  const session = await createSession(target);

  const response = await postWrites(
    target,
    [deleteWrite(rkeyOf(target.likeUris[0])), forbidden.write(target)],
    session.accessJwt,
  );

  expect(response.status, `applyWrites carrying ${forbidden.name} status`).toBe(400);
  expect(
    await remainingLikeUris(target),
    `nothing is applied when the request carries ${forbidden.name}`,
  ).toStrictEqual(target.likeUris);
}
