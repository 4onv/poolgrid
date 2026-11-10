import { readFile, mkdir, writeFile } from "node:fs/promises";
import { renderPlan } from "../src/compiler.js";
const plan = JSON.parse(
  await readFile(new URL("../examples/plan.json", import.meta.url), "utf8"),
);
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
const html = await renderPlan(plan);
await writeFile(new URL("../dist/poolgrid.html", import.meta.url), html);
console.log(
  "Built standalone synthetic demo (" + Buffer.byteLength(html) + " bytes).",
);
