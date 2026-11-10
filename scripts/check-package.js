import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const archive = path.resolve(process.argv[2] ?? "4onv-poolgrid-0.1.0.tgz"),
  npm = process.env.npm_execpath;
if (!npm) throw Error("Use npm run check:package.");
const directory = await mkdtemp(path.join(tmpdir(), "poolgrid-package-")),
  env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.NODE_TEST_CONTEXT;
function run(script, args, codes = [0]) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: directory,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
  });
  assert.ifError(r.error);
  assert.ok(codes.includes(r.status), r.stdout + "\n" + r.stderr);
  return r.stdout;
}
try {
  run(npm, [
    "install",
    "--prefix",
    directory,
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    archive,
  ]);
  const root = path.join(directory, "node_modules/@4onv/poolgrid"),
    bin = path.join(root, "bin/poolgrid.js");
  assert.equal(run(bin, ["--version"]).trim(), "0.1.0");
  run(bin, ["init", "--out", "plan.json"]);
  run(bin, ["demo", "--out", "demo.html"]);
  run(bin, ["report", "plan.json", "--out", "report.html"]);
  run(bin, ["markdown", "plan.json", "--out", "report.md"]);
  const check = JSON.parse(run(bin, ["check", "plan.json", "--json"], [1]));
  assert.equal(check.maximumRollout.resources[0].total, 133);
  run(bin, ["check", "plan.json", "--phase", "steady"]);
  assert.equal(JSON.parse(run(bin, ["matrix", "plan.json"])).cells.length, 35);
  const api = await import(pathToFileURL(path.join(root, "src/index.js")).href);
  assert.equal(
    api.analyzePlan(
      JSON.parse(await readFile(path.join(directory, "plan.json"), "utf8")),
    ).maximum.status,
    "within-budget",
  );
  console.log(
    "Exact archive installed offline; installed init/demo/report/check/matrix/markdown and public API passed.",
  );
} finally {
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith("poolgrid-package-"));
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 100,
  });
}
