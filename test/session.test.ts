// Feature: feature/delete-old-likes.feature (Test Cases 10 and 12, login half)
import { expect, test } from "vitest";
import { login } from "../src/session";
import { createFakeBluesky } from "./fake-bluesky";

const DID = "did:plc:fakeaccount000000000000";
const BASE_URL = "https://fake-bluesky.test";
const APP_PASSWORD = "fake-app-password";
const WRONG_PASSWORD = "wrong-app-password";

function newBluesky() {
  return createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
}

test("login with the right password sends one createSession", async () => {
  const bluesky = newBluesky();

  await login({ baseUrl: BASE_URL, did: DID, password: APP_PASSWORD, fetch: bluesky.fetch });

  expect(
    bluesky.requests().map(({ method, url }) => [method, new URL(url).pathname]),
  ).toStrictEqual([["POST", "/xrpc/com.atproto.server.createSession"]]);
});

test("the session's fetchHandler is authorised for applyWrites", async () => {
  const bluesky = newBluesky();
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
  const bluesky = newBluesky();

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
