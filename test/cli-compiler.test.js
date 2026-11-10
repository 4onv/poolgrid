import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { renderPlan } from "../src/compiler.js";
import { parseJson } from "../src/parse-json.js";
const p = JSON.parse(
    await readFile(new URL("../examples/plan.json", import.meta.url), "utf8"),
  ),
  bin = fileURLToPath(new URL("../bin/poolgrid.js", import.meta.url));
const run = (...args) =>
  spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    timeout: 20000,
  });
test("compiler is deterministic, hashes exact executable/style bytes and preserves hostile tokens as data", async () => {
  const input = structuredClone(p);
  input.title = "</script><img src=x onerror=alert(1)> %%JS%% %%CSS%%";
  const html = await renderPlan(input);
  assert.equal(html, await renderPlan(input));
  assert.ok(!html.includes("<img src=x"));
  const embedded = JSON.parse(
    html.match(
      /<script id="initial-plan" type="application\/json">([\s\S]*?)<\/script>/,
    )[1],
  );
  assert.equal(embedded.title, input.title);
  for (const tag of ["script", "style"]) {
    const value = html.match(
      new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"),
    )[1];
    assert.ok(
      html.includes(
        "'sha256-" + createHash("sha256").update(value).digest("base64") + "'",
      ),
    );
  }
  assert.ok(html.includes("connect-src 'none'"));
});
test("strict JSON parsing rejects ambiguous keys and oversized nesting", () => {
  assert.throws(() => parseJson('{"a":1,"\\u0061":2}'), /Duplicate/);
  assert.throws(() => parseJson("[".repeat(30) + "0" + "]".repeat(30)));
  assert.throws(() => parseJson('{"n":1e999}'));
});
test("CLI gates rollout separately from steady, preserves outputs and exports complete data", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "poolgrid-cli-"));
  try {
    const input = path.join(dir, "my plan.json"),
      html = path.join(dir, "report.html"),
      markdown = path.join(dir, "report.md");
    assert.equal(run("init", "--out", input).status, 0);
    const check = run("check", input, "--json");
    assert.equal(check.status, 1);
    assert.equal(
      JSON.parse(check.stdout).maximumRollout.resources[0].total,
      133,
    );
    assert.equal(run("check", input, "--phase", "steady").status, 0);
    assert.equal(JSON.parse(run("matrix", input).stdout).cells.length, 35);
    assert.equal(run("report", input, "--out", html).status, 0);
    assert.equal(run("markdown", input, "--out", markdown).status, 0);
    const old = await readFile(html);
    assert.equal(run("report", input, "--out", html).status, 2);
    assert.deepEqual(await readFile(html), old);
    assert.equal(run("report", input, "--out", input).status, 2);
    await writeFile(input, '{"version":1,"version":1}');
    assert.equal(run("check", input).status, 2);
    await writeFile(input, Buffer.from([0xff]));
    assert.equal(run("check", input).status, 2);
    assert.equal(run("check", dir).status, 2);
    assert.equal(run("check").status, 2);
    assert.equal(run("matrix", input, "--phase", "unknown").status, 2);
    assert.equal(run("demo", "--json").status, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test(
  "FIFO input fails without waiting for a writer",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "poolgrid-fifo-"));
    try {
      const file = path.join(dir, "input.json");
      assert.equal(spawnSync("mkfifo", [file]).status, 0);
      assert.equal(run("check", file).status, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
