import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/contract/live.contract.ts"],
    // The live walk makes about 35 sequential requests to the real server, so the default 5 s is too short.
    testTimeout: 120_000,
  },
});
