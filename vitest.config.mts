import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { APP_PASSWORD } from "./test/constants";

// The fake's password for the required secret, which wrangler reads from process.env. .env holds
// only the deploy credentials, so the real app password never enters a wrangler or test process.
process.env.BLUESKY_APP_PASSWORD = APP_PASSWORD;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup/network.ts"],
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"] },
    // One workerd runtime for every file. Isolated files each started a runtime and re-imported
    // @bsky/sdk, which took ~18 s of summed import time for ~0.2 s of tests. Sharing is safe because
    // the only patched global is fetch, which test/setup/network.ts hands to MSW once for every file.
    maxWorkers: 1,
    isolate: false,
    // Pre-bundle the fake's lexicon validator into one module instead of hundreds of small ones.
    deps: { optimizer: { ssr: { enabled: true, include: ["@bsky/sdk/lexicons"] } } },
    onConsoleLog: () => false,
  },
});
