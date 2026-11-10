import type { Fetch } from "./bluesky";

/** How long a request may take; a request that does not finish in time is aborted and fails the run. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Wraps fetch so a request that does not finish within the timeout is aborted; the rejection fails the run. */
export function withRequestTimeout(fetch: Fetch, timeoutMs: number = REQUEST_TIMEOUT_MS): Fetch {
  return (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
