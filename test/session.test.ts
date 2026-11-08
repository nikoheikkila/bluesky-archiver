// Feature: feature/delete-old-likes.feature (Test Cases 10 and 12, login half)
import { afterEach, expect, test, vi } from "vitest";
import { login } from "../src/session";
import { createFakeBluesky } from "./fake-bluesky";

const DID = "did:plc:fakeaccount000000000000";
const BASE_URL = "https://fake-bluesky.test";
const APP_PASSWORD = "fake-app-password";
const WRONG_PASSWORD = "wrong-app-password";

afterEach(() => {
  vi.restoreAllMocks();
});

test("login with the right password sends one createSession and authorises the handler, with the wrong password it rejects without leaking the password", async () => {
  const bluesky = createFakeBluesky({ did: DID, baseUrl: BASE_URL, appPassword: APP_PASSWORD });
  bluesky.intercept();

  const session = await login({ baseUrl: BASE_URL, did: DID, password: APP_PASSWORD });

  const loginPaths = bluesky.requests().map(({ method, url }) => [method, new URL(url).pathname]);
  expect(loginPaths).toStrictEqual([["POST", "/xrpc/com.atproto.server.createSession"]]);

  const authorised = await session.fetchHandler("/xrpc/com.atproto.repo.applyWrites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: DID, writes: [] }),
  });
  expect(authorised.status).toBe(200);

  const failure = await login({ baseUrl: BASE_URL, did: DID, password: WRONG_PASSWORD }).then(
    () => undefined,
    (error: unknown) => error as Error,
  );
  expect(failure, "login with the wrong password rejects").toBeInstanceOf(Error);
  expect(failure?.message).toContain("401");
  expect(failure?.message).not.toContain(WRONG_PASSWORD);
});

test.each([
  ["has no accessJwt key", { refreshJwt: "leaky-refresh-token", did: DID }],
  ["has a numeric accessJwt", { accessJwt: 12345, did: DID }],
  ["has an empty accessJwt", { accessJwt: "", did: DID }],
])("login rejects a 200 createSession response that %s, without leaking the password or the body", async (_name, body) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body));

  const failure = await login({ baseUrl: BASE_URL, did: DID, password: APP_PASSWORD }).then(
    () => undefined,
    (error: unknown) => error as Error,
  );

  expect(failure, "login rejects when the response lacks a string accessJwt").toBeInstanceOf(Error);
  expect(failure?.message).not.toContain(APP_PASSWORD);
  expect(failure?.message).not.toContain("leaky-refresh-token");
  expect(failure?.message).not.toContain("12345");
});
