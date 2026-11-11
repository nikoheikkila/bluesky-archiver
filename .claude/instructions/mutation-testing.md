# Mutation Testing

Stryker (`stryker.config.mjs`, Vitest runner) mutates `src/` except `src/index.ts`, which only binds
the global `fetch`, `console.debug` and `console.info` and cannot be tested without patching a
global. The score is 100% and `thresholds.break` is 100, so any surviving mutant fails the run,
`task check` and CI. Setup quirks: `tsconfigFile` points at a nonexistent file because
TypeScript 7 has no JS API for Stryker's tsconfig rewriter, and `ignorePatterns` keeps
`.claude`/`.agents` (symlinks) out of the sandbox copy. `.stryker-tmp/` and `reports/` are
gitignored.

Do not run the mutation harness inside each red-green cycle. Run it when work is ready, then kill
survivors with behaviour tests. Recheck with a scoped run, not the whole project:
`bunx stryker run --force --mutate src/<file>.ts[:<start>-<end>]`. Classify a survivor you cannot
kill as equivalent with a one-line argument rather than forcing a brittle test.
