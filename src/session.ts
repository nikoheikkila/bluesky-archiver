export interface LoginOptions {
  baseUrl: string;
  did: string;
  password: string;
}

export interface AuthorisedSession {
  fetchHandler(path: string, init?: RequestInit): Promise<Response>;
}

export async function login(options: LoginOptions): Promise<AuthorisedSession> {
  const response = await fetch(new URL("/xrpc/com.atproto.server.createSession", options.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: options.did, password: options.password }),
  });
  if (!response.ok) {
    throw new Error(`createSession failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as { accessJwt?: unknown } | null;
  const accessJwt = body?.accessJwt;
  if (typeof accessJwt !== "string" || accessJwt === "") {
    throw new Error("createSession returned no access token");
  }
  return {
    fetchHandler: async (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${accessJwt}`);
      return fetch(new URL(path, options.baseUrl), { ...init, headers });
    },
  };
}
