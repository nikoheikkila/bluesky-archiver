import { test } from "vitest";
import { walkListRecords } from "./list-records.contract";

// These two values match the BLUESKY_SERVER_URL and BLUESKY_DID vars in wrangler.jsonc.
const baseUrl = "https://shimeji.us-east.host.bsky.network";
const did = "did:plc:krt7mrzm5yv5wdcsr6cwpyiy";

test("real account serves listRecords like the contract", async () => {
  await walkListRecords({ baseUrl, did, limit: 100 });
});
