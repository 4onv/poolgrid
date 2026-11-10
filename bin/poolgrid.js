#!/usr/bin/env node
import { parseArgs } from "node:util";
import { open, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import {
  validatePlan,
  analyzePlan,
  buildGrid,
  toMarkdown,
} from "../src/core.js";
import { renderPlan } from "../src/compiler.js";
import { parseJson } from "../src/parse-json.js";
const help = `PoolGrid — connection budgets across scale and rollout

poolgrid demo --out demo.html
poolgrid init --out plan.json
poolgrid check plan.json [--json] [--phase rollout|steady]
poolgrid report plan.json --out report.html
poolgrid matrix plan.json [--phase rollout|steady]
poolgrid markdown plan.json --out report.md

init copies a visibly synthetic example for editing. Node.js 22+.
check evaluates all configured maximum replicas; rollout is the default.
Exit 0: within entered budgets; 1: over budget; 2: invalid input/error.
Other commands exit 0 on success. Every output filename must be new.
No database access, network requests or infrastructure changes.
`;
async function readPlan(file) {
  const handle = await open(
    file,
    constants.O_RDONLY |
      (process.platform === "win32" ? 0 : constants.O_NONBLOCK),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 256 * 1024)
      throw Error("Plan must be a regular file no larger than 256 KiB.");
    const buffer = Buffer.alloc(256 * 1024 + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 256 * 1024) throw Error("Plan file exceeds 256 KiB.");
    return validatePlan(
      parseJson(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, size),
        ),
      ),
    );
  } finally {
    await handle.close();
  }
}
async function writeNew(file, text, input) {
  if (!file) throw Error("Provide --out with a new filename.");
  if (input && path.resolve(file) === path.resolve(input))
    throw Error("Input and output must differ.");
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(text);
  } finally {
    await handle.close();
  }
  console.log("Wrote " + JSON.stringify(file));
}
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      phase: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
      version: { type: "boolean" },
    },
  });
  if (values.version) {
    console.log("0.1.0");
    return;
  }
  if (values.help || !positionals.length) {
    console.log(help);
    return;
  }
  const [command, input] = positionals;
  if (
    !["demo", "init", "check", "report", "matrix", "markdown"].includes(command)
  )
    throw Error("Unknown command. See --help.");
  if (positionals.length > (["demo", "init"].includes(command) ? 1 : 2))
    throw Error("Unexpected positional argument.");
  const accepted = ["check", "matrix"].includes(command)
    ? ["phase", "json"]
    : ["out"];
  for (const key of Object.keys(values))
    if (!accepted.includes(key))
      throw Error("Unsupported option for this command.");
  const phase = values.phase ?? "rollout";
  if (!["rollout", "steady"].includes(phase))
    throw Error("Phase must be rollout or steady.");
  if (["demo", "init"].includes(command)) {
    const example = validatePlan(
      JSON.parse(
        await readFile(
          new URL("../examples/plan.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    await writeNew(
      values.out,
      command === "demo"
        ? await renderPlan(example)
        : JSON.stringify(example, null, 2) + "\n",
    );
    return;
  }
  if (!input) throw Error("Provide a plan JSON file.");
  const plan = await readPlan(input);
  if (command === "report") {
    await writeNew(values.out, await renderPlan(plan), input);
    return;
  }
  if (command === "markdown") {
    await writeNew(values.out, toMarkdown(plan), input);
    return;
  }
  if (command === "matrix") {
    console.log(JSON.stringify(buildGrid(plan, { phase }), null, 2));
    return;
  }
  const report = analyzePlan(plan),
    selected = phase === "rollout" ? report.maximumRollout : report.maximum;
  console.log(
    values.json
      ? JSON.stringify(
          {
            ...report,
            checkedScenario: phase === "rollout" ? "maximumRollout" : "maximum",
            status: selected.status,
          },
          null,
          2,
        )
      : "Maximum " +
          phase +
          ": " +
          selected.status +
          "\n" +
          selected.resources
            .map(
              (r) =>
                JSON.stringify(r.id) +
                ": " +
                r.total +
                " / " +
                r.limit +
                " (" +
                r.remaining +
                " remaining)",
            )
            .join("\n") +
          "\nEntered ceilings only; this is not a performance or deployment-safety test.",
  );
  if (selected.status === "over-budget") process.exitCode = 1;
}
main().catch((error) => {
  console.error(
    "PoolGrid: " +
      (error.code === "EEXIST"
        ? "Output already exists; choose a new filename."
        : error.message),
  );
  process.exitCode = 2;
});
