// Mutates only production files changed on this branch relative to a base (default: origin's default branch).
// Usage: bun run scripts/stryker-diff.ts [base]
const fail = (message: string) => process.stderr.write(`${message}\n`);
const run = (cmd: string[]) => Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
const text = (b: Uint8Array) => new TextDecoder().decode(b);

if (text(run(["git", "status", "--porcelain"]).stdout).trim() !== "") {
  fail(
    "Working tree is not clean. <base>...HEAD excludes staged, unstaged and untracked work; commit it first.",
  );
  process.exit(1);
}

const detectBase = () => {
  const head = run(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return head.exitCode === 0 ? text(head.stdout).trim() : "main";
};
const base = process.argv[2] ?? detectBase();

const diff = run(["git", "diff", "--name-only", "-z", "--diff-filter=ACMRTUXB", `${base}...HEAD`]);
if (diff.exitCode !== 0) {
  fail(text(diff.stderr));
  process.exit(1);
}

const files = text(diff.stdout)
  .split("\0")
  .filter((f) => /^src\/.*\.ts$/.test(f) && !f.endsWith(".d.ts") && !/\.(test|spec)\.ts$/.test(f));

if (files.length === 0) {
  console.log(`No changed production files against ${base}; nothing to mutate.`);
  process.exit(0);
}
const comma = files.find((f) => f.includes(","));
if (comma) {
  fail(`Cannot pass a file name containing a comma to --mutate: ${comma}`);
  process.exit(1);
}

const result = Bun.spawnSync(["node_modules/.bin/stryker", "run", "--mutate", files.join(",")], {
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(result.exitCode ?? 1);
