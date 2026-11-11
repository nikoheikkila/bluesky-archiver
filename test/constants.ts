export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const YEAR = 365 * DAY;

/** Every test fixes the run start, so it passes at any wall-clock time. */
export const RUN_START = Date.parse("2026-11-08T03:00:00Z");

/** The fake account the unit tests run against, unless a test needs the Worker's own env. */
export const DID = "did:plc:fakeaccount000000000000";
export const BASE_URL = "https://fake-bluesky.test";
export const APP_PASSWORD = "fake-app-password";
export const WRONG_PASSWORD = "wrong-app-password";
export const CID = "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm";

/** The ISO timestamp `ms` before `from` (the run start by default). */
export const createdAgo = (ms: number, from = RUN_START) => new Date(from - ms).toISOString();

/** The record key: the last segment of an at:// URI. */
export const rkeyOf = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);
