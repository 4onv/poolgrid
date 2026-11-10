import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validatePlan,
  evaluateScenario,
  analyzePlan,
  buildGrid,
  toMarkdown,
} from "../src/core.js";
const example = JSON.parse(
  await readFile(new URL("../examples/plan.json", import.meta.url), "utf8"),
);
test("synthetic demo fits steady maximum but exceeds its primary budget during overlap", () => {
  const r = analyzePlan(example);
  assert.equal(r.current.resources[0].total, 45);
  assert.equal(r.maximum.resources[0].total, 105);
  assert.equal(r.maximumRollout.resources[0].total, 133);
  assert.equal(r.maximumRollout.resources[0].remaining, -13);
  assert.equal(r.maximum.status, "within-budget");
  assert.equal(r.maximumRollout.status, "over-budget");
  assert.equal(r.maximumRollout.resources[1].remaining, 2);
});
test("every demo grid cell agrees with an independently written integer model", () => {
  for (const phase of ["steady", "rollout"])
    for (const cell of buildGrid(example, { phase }).cells) {
      const wx =
          cell.x + (phase === "rollout" && cell.x ? Math.ceil(cell.x / 4) : 0),
        wy = cell.y + (phase === "rollout" && cell.y ? 1 : 0);
      assert.equal(cell.resources[0].total, wx * 12 + wy * 4 + 17);
      assert.equal(cell.resources[1].total, wy * 6 + 8);
      assert.equal(
        cell.status,
        wx * 12 + wy * 4 + 17 > 120 || wy * 6 + 8 > 40
          ? "over-budget"
          : "within-budget",
      );
    }
});
test("pool holder mode multiplies process-local pools but not shared replica pools", () => {
  const p = structuredClone(example);
  p.services[0].processes = 4;
  p.services[0].pools.push({
    id: "shared",
    resourceId: "primary",
    size: 3,
    per: "replica",
  });
  const row = evaluateScenario(p, {
    phase: "steady",
    replicas: { web: 2, worker: 0 },
  }).contributions[0];
  assert.equal(row.pools[0].connections, 48);
  assert.equal(row.pools[1].connections, 6);
});
test("percent surge rounds upward, fixed surge is explicit, and zero targets have no surge", () => {
  const p = structuredClone(example);
  p.services[0].surge.value = 1;
  assert.equal(
    evaluateScenario(p, { replicas: { web: 1 } }).contributions[0]
      .surgeReplicas,
    1,
  );
  assert.equal(
    evaluateScenario(p, { replicas: { web: 0 } }).contributions[0]
      .surgeReplicas,
    0,
  );
  assert.equal(evaluateScenario(p).contributions[1].surgeReplicas, 1);
});
test("exact equality fits; reserves and outside clients can exhaust a budget without services", () => {
  const p = structuredClone(example);
  p.resources[0].limit = 133;
  assert.equal(
    analyzePlan(p).maximumRollout.resources[0].status,
    "within-budget",
  );
  p.resources[0].reserved = 200;
  const r = evaluateScenario(p, {
    replicas: { web: 0, worker: 0, scheduler: 0 },
  });
  assert.equal(r.resources[0].total, 205);
  assert.equal(r.status, "over-budget");
});
test("a second resource can overrun when the displayed primary resource still fits", () => {
  const p = structuredClone(example);
  p.resources[0].limit = 1000;
  p.resources[1].limit = 20;
  const r = analyzePlan(p);
  assert.equal(r.maximumRollout.resources[0].status, "within-budget");
  assert.equal(r.maximumRollout.status, "over-budget");
  assert.equal(buildGrid(p).cells.at(-1).status, "over-budget");
});
test("zero caps and multiple pools targeting one resource preserve exact counts", () => {
  const p = structuredClone(example);
  p.services[0].maxReplicas = 0;
  p.services[0].replicas = 0;
  p.services[1].pools.push({
    id: "another",
    resourceId: "primary",
    size: 2,
    per: "replica",
  });
  const g = buildGrid(p);
  assert.equal(g.columns, 1);
  assert.equal(g.cells.length, 5);
  assert.equal(analyzePlan(p).maximumRollout.resources[0].total, 47);
});
test("strict validation rejects malformed shapes, duplicate IDs and unresolved references", () => {
  for (const mutate of [
    (p) => (p.extra = true),
    (p) => delete p.title,
    (p) => (p.services[0].pools[0].secret = "x"),
    (p) => p.resources.push(p.resources[0]),
    (p) => p.services.push(p.services[0]),
    (p) => p.services[0].pools.push(p.services[0].pools[0]),
    (p) => (p.axes.y = p.axes.x),
    (p) => (p.axes.x = "unknown"),
    (p) => (p.services[0].pools[0].resourceId = "unknown"),
    (p) => (p.services[0].pools[0].per = "thread"),
    (p) => (p.services[0].surge.type = "ratio"),
  ]) {
    const p = structuredClone(example);
    mutate(p);
    assert.throws(() => validatePlan(p));
  }
});
test("numeric bounds reject coercion, fractions, negative values and non-finite values", () => {
  for (const value of ["6", -1, 1.5, 65, Infinity, NaN]) {
    const p = structuredClone(example);
    p.services[0].maxReplicas = value;
    assert.throws(() => validatePlan(p));
  }
  for (const value of [-1, 1.1, 10001]) {
    const p = structuredClone(example);
    p.services[0].pools[0].size = value;
    assert.throws(() => validatePlan(p));
  }
  assert.throws(() => evaluateScenario(example, { replicas: { web: 7 } }));
  assert.throws(() => evaluateScenario(example, { replicas: { unknown: 1 } }));
  assert.throws(() => buildGrid(example, { phase: "unknown" }));
});
test("no getters, sparse arrays, inherited data or malformed text enter the model", () => {
  const getter = structuredClone(example);
  Object.defineProperty(getter, "title", {
    get() {
      assert.fail("Getter was executed");
    },
    enumerable: true,
  });
  assert.throws(() => validatePlan(getter), /accessor/);
  const sparse = structuredClone(example);
  delete sparse.services[0];
  assert.throws(() => validatePlan(sparse));
  assert.throws(() => validatePlan(Object.create(example)));
  for (const value of ["", "\ud800", "bad\u001btext"]) {
    const p = structuredClone(example);
    p.title = value;
    assert.throws(() => validatePlan(p));
  }
});
test("validation and calculations never mutate caller-owned data", () => {
  const before = JSON.stringify(example),
    normalized = validatePlan(example);
  normalized.services[0].pools[0].size = 99;
  analyzePlan(example);
  buildGrid(example);
  evaluateScenario(example);
  assert.equal(JSON.stringify(example), before);
});
test("option typos and accessor overrides cannot silently change the selected scenario", () => {
  assert.throws(
    () => evaluateScenario(example, { replica: { web: 0 } }),
    /option/,
  );
  assert.throws(
    () => buildGrid(example, { phase: "rollout", replicas: {} }),
    /option/,
  );
  const values = {};
  Object.defineProperty(values, "web", {
    get() {
      assert.fail("Executed override getter");
    },
    enumerable: true,
  });
  assert.throws(
    () => evaluateScenario(example, { replicas: values }),
    /accessor/,
  );
});
test("Markdown is an escaped, auditable assumptions snapshot", () => {
  const p = structuredClone(example);
  p.title = "<img onerror=alert(1)> [evil](https://invalid.test)";
  const result = toMarkdown(p);
  assert.ok(!result.includes("<img"));
  assert.ok(result.includes("133"));
  assert.ok(result.includes("rounded up"));
  assert.ok(result.includes("per-process") || result.includes("process"));
});
