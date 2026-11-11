// Shared contract for com.atproto.server.createSession and com.atproto.repo.applyWrites
// (deletes of app.bsky.feed.like, app.bsky.feed.repost, app.bsky.feed.post, app.bsky.feed.threadgate and
// app.bsky.feed.postgate). Holds for the fake; the default suite never sends it to the real server.
import { expect } from "vitest";
import type { Fetch } from "../../src/bluesky";
import type { Collection } from "../../src/domain-types";
import { CID, rkeyOf } from "../constants";
import { walkListRecords } from "./list-records.contract";

export interface WriteTarget {
  baseUrl: string;
  did: string;
  appPassword: string;
  /** URIs of exactly three records of `collection`, in this order. */
  recordUris: [string, string, string];
  fetch: Fetch;
  /** Defaults to app.bsky.feed.like. */
  collection?: Collection;
}

interface SessionResponse {
  accessJwt: string;
  refreshJwt: string;
  handle: string;
  did: string;
}

const MAX_WRITES = 200;

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

async function remainingUris(target: WriteTarget): Promise<string[]> {
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
  const [first, second, third] = target.recordUris;

  const session = await createSession(target);

  const deleted = await applyWrites(target, [rkeyOf(first), rkeyOf(second)], session.accessJwt);
  expect(deleted.status, "applyWrites deleting 2 of 3 records status").toBe(200);
  const afterDelete = await remainingUris(target);
  expect(afterDelete, "only the third record remains after deleting 2 of 3").toStrictEqual([third]);

  const tooMany = [
    rkeyOf(third),
    ...Array.from({ length: MAX_WRITES }, (_, index) => `absent${index}`),
  ];
  const oversized = await applyWrites(target, tooMany, session.accessJwt);
  expect(oversized.status, "applyWrites with 201 deletes status").toBe(400);
  expect(await remainingUris(target), "nothing is deleted by the oversized batch").toStrictEqual([
    third,
  ]);

  const anonymous = await applyWrites(target, [rkeyOf(third)]);
  expect(anonymous.status, "applyWrites without a token status").toBe(401);
  expect(await remainingUris(target), "nothing is deleted without a token").toStrictEqual([third]);

  return { afterDelete };
}

// Writes that are valid under the applyWrites lexicon but break the rule that applyWrites carries only
// deletes of the account's likes, reposts and posts. Each one travels together with a valid like delete.
export interface ForbiddenWrite {
  name: string;
  write(target: WriteTarget): object;
}

function likeValue(target: WriteTarget) {
  return {
    $type: "app.bsky.feed.like",
    subject: { uri: target.recordUris[1], cid: CID },
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
      rkey: rkeyOf(target.recordUris[1]),
      value: likeValue(target),
    }),
  },
  {
    name: "a delete of app.bsky.actor.profile",
    write: () => ({
      $type: "com.atproto.repo.applyWrites#delete",
      collection: "app.bsky.actor.profile",
      rkey: "self",
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
    [deleteWrite(rkeyOf(target.recordUris[0])), forbidden.write(target)],
    session.accessJwt,
  );

  expect(response.status, `applyWrites carrying ${forbidden.name} status`).toBe(400);
  expect(
    await remainingUris(target),
    `nothing is applied when the request carries ${forbidden.name}`,
  ).toStrictEqual(target.recordUris);
}
