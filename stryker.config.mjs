// Mutates first-party Worker source only. Tests run in workerd through the Vitest runner.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.mts" },
  // TypeScript 7 has no JS API, which Stryker's tsconfig rewriter needs. Vitest transpiles without
  // reading tsconfig, so point the rewriter at a file that does not exist.
  tsconfigFile: "tsconfig.stryker-unused.json",
  // The measured baseline is 100%, so any surviving mutant fails the run.
  thresholds: { high: 100, low: 100, break: 100 },
  coverageAnalysis: "perTest",
  // index.ts only binds the run to the global fetch and console.log. Killing its mutants would need
  // a test that patches a global or reaches the real network, which the test style forbids.
  mutate: ["src/**/*.ts", "!src/**/*.d.ts", "!src/index.ts"],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  incrementalFile: "reports/stryker-incremental.json",
  tempDirName: ".stryker-tmp",
  // Keep the sandbox copy to what the tests need: .claude/.agents hold symlinks the copy cannot handle.
  ignorePatterns: [
    ".claude",
    ".agents",
    ".git",
    "specs",
    "reports",
    ".wrangler",
    "feature",
    "scripts",
  ],
  cleanTempDir: true,
};
