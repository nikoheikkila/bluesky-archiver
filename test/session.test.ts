// Feature: feature/delete-old-likes.feature (Test Cases 10 and 12, login half)
import { expect, test } from "vitest";
import { login } from "../src/session";
import { APP_PASSWORD, BASE_URL, DID, WRONG_PASSWORD } from "./constants";
import { createFakeBluesky } from "./fake-bluesky";
import { endlessBody } from "./streams";

test("login with the right password sends one createSession", async () => {
  const bluesky = createFakeBluesky({ appPassword: APP_PASSWORD });

  await login({ baseUrl: BASE_URL, did: DID, password: APP_PASSWORD, fetch: bluesky.fetch });

  expect(
    bluesky.requests().map(({ method, url }) => [method, new URL(url).pathname]),
  ).toStrictEqual([["POST", "/xrpc/com.atproto.server.createSession"]]);
});

test("the session's fetchHandler is authorised for applyWrites", async () => {
  const bluesky = createFakeBluesky({ appPassword: APP_PASSWORD });
  const session = await login({
    baseUrl: BASE_URL,
    did: DID,
    password: APP_PASSWORD,
    fetch: bluesky.fetch,
  });

  const response = await session.fetchHandler("/xrpc/com.atproto.repo.applyWrites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: DID, writes: [] }),
  });

  expect(response.status).toBe(200);
});

test("login with the wrong password rejects with HTTP 401 without leaking the password", async () => {
  const bluesky = createFakeBluesky({ appPassword: APP_PASSWORD });

  const failure = await login({
    baseUrl: BASE_URL,
    did: DID,
    password: WRONG_PASSWORD,
    fetch: bluesky.fetch,
  }).catch((error: unknown) => error);

  expect(failure, "login with the wrong password rejects").toBeInstanceOf(Error);
  expect((failure as Error).message).toContain("401");
  expect((failure as Error).message).not.toContain(WRONG_PASSWORD);
});

test.each([
  { problem: "has no accessJwt key", body: { refreshJwt: "leaky-refresh-token", did: DID } },
  { problem: "has a numeric accessJwt", body: { accessJwt: 12345, did: DID } },
  { problem: "has an empty accessJwt", body: { accessJwt: "", did: DID } },
  { problem: "is null", body: null },
])(
  "login rejects a 200 createSession response that $problem, without leaking the password or the body",
  async ({ body }) => {
    const answerWithBody = async () => Response.json(body);

    const failure = await login({
      baseUrl: BASE_URL,
      did: DID,
      password: APP_PASSWORD,
      fetch: answerWithBody,
    }).catch((error: unknown) => error);

    expect(failure, "login rejects when the response lacks a string accessJwt").toBeInstanceOf(
      Error,
    );
    expect((failure as Error).message).toBe("createSession returned no access token");
    expect((failure as Error).message).not.toContain(APP_PASSWORD);
    expect((failure as Error).message).not.toContain("leaky-refresh-token");
    expect((failure as Error).message).not.toContain("12345");
  },
);

test("sends createSession as JSON", async () => {
  const inits: (RequestInit | undefined)[] = [];
  const answerWithToken = async (_input: URL | string, init?: RequestInit) => {
    inits.push(init);
    return Response.json({ accessJwt: "fake-access-jwt", did: DID });
  };

  await login({ baseUrl: BASE_URL, did: DID, password: APP_PASSWORD, fetch: answerWithToken });

  expect(inits.map((init) => new Headers(init?.headers).get("content-type"))).toStrictEqual([
    "application/json",
  ]);
});

test("refuses to follow a redirect, so the password is never resent to another host", async () => {
  const inits: (RequestInit | undefined)[] = [];
  const answerWithToken = async (_input: URL | string, init?: RequestInit) => {
    inits.push(init);
    return Response.json({ accessJwt: "fake-access-jwt", did: DID });
  };

  await login({ baseUrl: BASE_URL, did: DID, password: APP_PASSWORD, fetch: answerWithToken });

  expect(inits.map((init) => init?.redirect)).toStrictEqual(["manual"]);
});

test("login rejects a redirected createSession without leaking the password", async () => {
  const redirect = async () =>
    new Response(null, { status: 307, headers: { Location: "https://elsewhere.test/" } });

  const failure = await login({
    baseUrl: BASE_URL,
    did: DID,
    password: APP_PASSWORD,
    fetch: redirect,
  }).catch((error: unknown) => error);

  expect(failure, "login rejects a redirect").toBeInstanceOf(Error);
  expect((failure as Error).message).toBe("createSession failed with HTTP 307");
  expect((failure as Error).message).not.toContain(APP_PASSWORD);
});

test("login cancels the unread body of a failed createSession before rejecting", async () => {
  const cancelled: unknown[] = [];
  const unauthorised = async () => new Response(endlessBody(cancelled), { status: 401 });

  await expect(
    login({ baseUrl: BASE_URL, did: DID, password: APP_PASSWORD, fetch: unauthorised }),
  ).rejects.toThrow("createSession failed with HTTP 401");
  expect(cancelled).toHaveLength(1);
});
