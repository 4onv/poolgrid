import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderPlan } from "../../src/compiler.js";
const plan = JSON.parse(
  await readFile(new URL("../../examples/plan.json", import.meta.url), "utf8"),
);
const url = pathToFileURL(
  fileURLToPath(new URL("../../dist/poolgrid.html", import.meta.url)),
).href;
async function ready(page) {
  await expect(page.locator("#matrix button")).toHaveCount(35);
}
async function edit(page, next) {
  await page.locator("#edit").click();
  await page.locator("#plan-source").fill(JSON.stringify(next));
  await page.locator('#editor-form button[type="submit"]').click();
}
test("phase changes preserve selection and show exact rollout arithmetic", async ({
  page,
}) => {
  await page.goto(url);
  await ready(page);
  await expect(page.locator("#selection-status")).toContainText("over budget");
  await expect(page.locator("#selected-resources")).toContainText("133");
  await page.locator("#steady").click();
  await expect(page.locator("#selection-status")).toContainText(
    "within budget",
  );
  await expect(page.locator("#selected-resources")).toContainText("105");
  await page.locator("#rollout").click();
  await page.locator('#matrix button[data-x="2"][data-y="1"]').click();
  await expect(page.locator("#selection-status")).toContainText(
    "within budget",
  );
  await expect(page.locator("#contributions")).toContainText(
    "3 concurrent replicas",
  );
  await expect(page.locator("#x-range")).toHaveValue("2");
  await page.locator("#x-range").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#x-value")).toHaveText("3");
});
test("a non-displayed resource still makes a cell over budget", async ({
  page,
}) => {
  const next = structuredClone(plan);
  next.resources[0].limit = 1000;
  next.resources[1].limit = 20;
  await page.goto(url);
  await ready(page);
  await edit(page, next);
  await expect(page.locator("#editor")).not.toBeVisible();
  const cell = page.locator('#matrix button[data-x="6"][data-y="4"]');
  await expect(cell).toHaveClass("over-budget");
  await expect(cell).toHaveText("+867");
  await page.locator("#resource").selectOption("analytics");
  await expect(cell).toHaveText("-18");
  await expect(page.locator("#selection-status")).toContainText("over budget");
});
test("plan, snapshot and Markdown downloads match the applied plan and selected scenario", async ({
  page,
}) => {
  await page.goto(url);
  await ready(page);
  await page.locator('#matrix button[data-x="1"][data-y="2"]').click();
  for (const [button, name] of [
    ["#export-plan", "plan"],
    ["#export-snapshot", "snapshot"],
    ["#export-md", "md"],
  ]) {
    const pending = page.waitForEvent("download");
    await page.locator(button).click();
    const text = await readFile(await (await pending).path(), "utf8");
    if (name === "plan") expect(JSON.parse(text)).toEqual(plan);
    else if (name === "snapshot") {
      const data = JSON.parse(text);
      expect(data.plan).toEqual(plan);
      expect(data.selected.replicas.web).toBe(1);
      expect(data.selected.replicas.worker).toBe(2);
      expect(data.analysis.maximumRollout.resources[0].total).toBe(133);
    } else expect(text).toContain("maximumRollout");
  }
  const changed = structuredClone(plan);
  changed.resources[0].limit = 200;
  await page
    .locator("#import-file")
    .setInputFiles({
      name: "plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(changed)),
    });
  await expect(page.locator("#selection-status")).toContainText(
    "within budget",
  );
});
test("invalid editor changes and repeated ambiguous imports preserve the last valid model", async ({
  page,
}) => {
  await page.goto(url);
  await ready(page);
  const next = structuredClone(plan);
  next.services[0].pools[0].size = -1;
  await edit(page, next);
  await expect(page.locator("#editor-error")).toBeVisible();
  await page.locator("#close-editor").click();
  await expect(page.locator("#selected-resources")).toContainText("133");
  const bad = {
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":1,"version":1}'),
  };
  await page.locator("#import-file").setInputFiles(bad);
  await expect(page.locator("#error")).toBeVisible();
  await page.locator("#import-file").setInputFiles(bad);
  await expect(page.locator("#error")).toBeVisible();
  await expect(page.locator("#matrix button")).toHaveCount(35);
});
test("hostile content stays text; no network or script errors; mobile and keyboard dialogs work", async ({
  page,
}, testInfo) => {
  const next = structuredClone(plan);
  next.title =
    '</script><img src="https://invalid.test/x" onerror="globalThis.pwned=1"> %%JS%%';
  const file = testInfo.outputPath("hostile.html");
  await writeFile(file, await renderPlan(next));
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(pathToFileURL(file).href);
  await ready(page);
  await expect(page.locator("#title")).toHaveText(next.title);
  expect(await page.evaluate(() => globalThis.pwned)).toBeUndefined();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
  await page.locator("#edit").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#plan-source")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#editor")).not.toBeVisible();
});
