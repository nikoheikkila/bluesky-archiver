import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"] },
    // One workerd runtime for every file. Isolated files each started a runtime and re-imported
    // @bsky/sdk, which took ~18 s of summed import time for ~0.2 s of tests. Sharing is safe because
    // no test patches a global: the code under test receives the fake's fetch and a log function.
    maxWorkers: 1,
    isolate: false,
    // Pre-bundle the fake's lexicon validator into one module instead of hundreds of small ones.
    deps: { optimizer: { ssr: { enabled: true, include: ["@bsky/sdk/lexicons"] } } },
  },
});
