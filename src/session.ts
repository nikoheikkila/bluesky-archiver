import type { Repo } from "./bluesky";
import { failRequest, readJson } from "./body";

export interface LoginOptions extends Repo {
  password: string;
}

export interface AuthorisedSession {
  fetchHandler(path: string, init?: RequestInit): Promise<Response>;
}

export async function login({
  baseUrl,
  did,
  password,
  fetch,
}: LoginOptions): Promise<AuthorisedSession> {
  const response = await fetch(new URL("/xrpc/com.atproto.server.createSession", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: did, password }),
  });
  if (!response.ok) {
    return failRequest(response, "createSession");
  }
  const body = await readJson<{ accessJwt?: unknown } | null>(response);
  const accessJwt = body?.accessJwt;
  if (typeof accessJwt !== "string" || accessJwt === "") {
    throw new Error("createSession returned no access token");
  }
  // The handler keeps only the base URL, fetch and token alive, never the password.
  return {
    fetchHandler: (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${accessJwt}`);
      return fetch(new URL(path, baseUrl), { ...init, headers });
    },
  };
}
