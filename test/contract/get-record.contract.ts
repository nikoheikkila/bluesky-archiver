// Shared contract for com.atproto.repo.getRecord on the account's profile record
// (app.bsky.actor.profile, record key "self"). Unauthenticated, like the Worker's own read.
// Holds for any public account: it runs against the fake and, opt-in, the real server.
import { app, com } from "@bsky/sdk/lexicons";
import { expect } from "vitest";
import type { Fetch } from "../../src/bluesky";

export interface GetRecordTarget {
  baseUrl: string;
  did: string;
  fetch: Fetch;
  /** Defaults to app.bsky.actor.profile. */
  collection?: string;
  /** Defaults to self. */
  rkey?: string;
}

export interface RecordResponse {
  status: number;
  body: {
    uri?: string;
    cid?: string;
    value?: { $type?: string; pinnedPost?: { uri: string; cid: string } };
    error?: string;
    message?: string;
  };
}

export const PROFILE_COLLECTION = "app.bsky.actor.profile";

export function profileUri(did: string): string {
  return `at://${did}/${PROFILE_COLLECTION}/self`;
}

export async function fetchRecord(target: GetRecordTarget): Promise<RecordResponse> {
  const url = new URL("/xrpc/com.atproto.repo.getRecord", target.baseUrl);
  url.search = new URLSearchParams({
    repo: target.did,
    collection: target.collection ?? PROFILE_COLLECTION,
    rkey: target.rkey ?? "self",
  }).toString();
  const response = await target.fetch(url);
  return { status: response.status, body: await response.json() };
}

// A stored profile is served as a record whose value validates against the profile lexicon.
export async function walkProfile(target: GetRecordTarget): Promise<RecordResponse["body"]> {
  const { status, body } = await fetchRecord(target);

  expect(status, "getRecord for the profile status").toBe(200);
  expect(body, "the profile comes back as a record with its uri, cid and value").toEqual({
    uri: profileUri(target.did),
    cid: expect.any(String),
    value: expect.objectContaining({ $type: PROFILE_COLLECTION }),
  });
  expect(() => {
    com.atproto.repo.getRecord.$output.schema.validate(body);
    app.bsky.actor.profile.$assert(body.value);
  }, "the served profile validates against its lexicon").not.toThrow();

  return body;
}

// An account with no profile record gets the real server's RecordNotFound answer.
export async function walkMissingProfile(target: GetRecordTarget): Promise<void> {
  const response = await fetchRecord(target);

  expect(response, "getRecord without a profile answers RecordNotFound").toStrictEqual({
    status: 400,
    body: {
      error: "RecordNotFound",
      message: `Could not locate record: ${profileUri(target.did)}`,
    },
  });
}
