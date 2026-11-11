import type { Fetch } from "./bluesky";
import { discardBody, readJson } from "./body";

export interface LoginOptions {
  baseUrl: string;
  did: string;
  password: string;
  fetch: Fetch;
}

export interface AuthorisedSession {
  fetchHandler(path: string, init?: RequestInit): Promise<Response>;
}

function requestSession(options: LoginOptions): Promise<Response> {
  return options.fetch(new URL("/xrpc/com.atproto.server.createSession", options.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: options.did, password: options.password }),
  });
}

async function readAccessToken(response: Response): Promise<string> {
  if (!response.ok) {
    await discardBody(response);
    throw new Error(`createSession failed with HTTP ${response.status}`);
  }
  const body = await readJson<{ accessJwt?: unknown } | null>(response);
  const accessJwt = body?.accessJwt;
  if (typeof accessJwt !== "string" || accessJwt === "") {
    throw new Error("createSession returned no access token");
  }
  return accessJwt;
}

function authorisedFetch(
  options: LoginOptions,
  accessJwt: string,
): AuthorisedSession["fetchHandler"] {
  return (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessJwt}`);
    return options.fetch(new URL(path, options.baseUrl), { ...init, headers });
  };
}

export async function login(options: LoginOptions): Promise<AuthorisedSession> {
  const response = await requestSession(options);
  const accessJwt = await readAccessToken(response);
  return { fetchHandler: authorisedFetch(options, accessJwt) };
}
