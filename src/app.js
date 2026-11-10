const $ = (id) => document.getElementById(id);
const node = (tag, value, classes) => {
  const el = document.createElement(tag);
  if (value !== undefined) el.textContent = value;
  if (classes) el.className = classes;
  return el;
};
let plan = validatePlan(parseJson($("initial-plan").textContent)),
  phase = "rollout",
  x,
  y,
  resource;
const signed = (n) => (n > 0 ? "+" + n : String(n));
function download(name, value, type) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = node("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fail(error) {
  $("error").textContent = error.message || "Could not apply plan.";
  $("error").hidden = false;
}
function resetSelection() {
  x = plan.services.find((s) => s.id === plan.axes.x).maxReplicas;
  y = plan.services.find((s) => s.id === plan.axes.y).maxReplicas;
  resource = plan.resources[0].id;
}
function scenario() {
  return evaluateScenario(plan, {
    phase,
    replicas: { [plan.axes.x]: x, [plan.axes.y]: y },
  });
}
function render() {
  $("title").textContent = plan.title;
  $("description").textContent = plan.description;
  for (const name of ["steady", "rollout"])
    $(name).setAttribute("aria-pressed", String(phase === name));
  const report = analyzePlan(plan),
    cards = $("summary-cards");
  cards.replaceChildren();
  for (const r of plan.resources) {
    const card = node("div", undefined, "summary-card");
    card.append(node("h3", r.name));
    const totals = node("div", undefined, "totals");
    for (const [key, label] of [
      ["maximum", "STEADY"],
      ["maximumRollout", "ROLLOUT"],
    ]) {
      const result = report[key].resources.find((row) => row.id === r.id),
        part = node("div");
      part.append(node("div", label, "total-label"));
      const value = node(
        "div",
        String(result.total),
        "total-number " + (result.remaining < 0 ? "over" : "within"),
      );
      value.append(node("small", " / " + r.limit));
      part.append(
        value,
        node(
          "div",
          signed(result.remaining) + " remaining",
          "total-foot " + (result.remaining < 0 ? "over" : "within"),
        ),
      );
      totals.append(part);
    }
    card.append(totals);
    cards.append(card);
  }
  const select = $("resource");
  select.replaceChildren();
  for (const r of plan.resources) {
    const option = node("option", r.name);
    option.value = r.id;
    select.append(option);
  }
  select.value = resource;
  const sx = plan.services.find((s) => s.id === plan.axes.x),
    sy = plan.services.find((s) => s.id === plan.axes.y);
  $("matrix-caption").textContent =
    sy.name +
    " replicas ↓ / " +
    sx.name +
    " replicas →. Other services stay at their configured maximums.";
  for (const [axis, service, value] of [
    ["x", sx, x],
    ["y", sy, y],
  ]) {
    $(axis + "-label").textContent = service.name + " replicas";
    $(axis + "-range").max = service.maxReplicas;
    $(axis + "-range").value = value;
    $(axis + "-value").value = value;
  }
  const table = $("matrix");
  table.replaceChildren();
  const grid = buildGrid(plan, { phase }),
    thead = node("thead"),
    head = node("tr");
  head.append(node("th", "↓ / →"));
  for (let col = 0; col < grid.columns; col++) {
    const th = node("th", String(col));
    th.scope = "col";
    head.append(th);
  }
  thead.append(head);
  table.append(thead);
  const body = node("tbody");
  for (let row = 0; row < grid.rows; row++) {
    const tr = node("tr"),
      th = node("th", String(row));
    th.scope = "row";
    tr.append(th);
    for (let col = 0; col < grid.columns; col++) {
      const cell = grid.cells[row * grid.columns + col],
        r = cell.resources.find((r) => r.id === resource),
        td = node("td"),
        button = node("button", signed(r.remaining), cell.status);
      button.type = "button";
      button.dataset.x = col;
      button.dataset.y = row;
      button.setAttribute("aria-pressed", String(x === col && y === row));
      button.setAttribute(
        "aria-label",
        sx.name +
          " " +
          col +
          ", " +
          sy.name +
          " " +
          row +
          ": " +
          signed(r.remaining) +
          " remaining in " +
          plan.resources.find((r) => r.id === resource).name +
          "; " +
          cell.status,
      );
      button.addEventListener("click", () => {
        x = col;
        y = row;
        renderSelection();
        markSelection();
      });
      td.append(button);
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  table.style.minWidth = String(Math.max(280, grid.columns * 36 + 32)) + "px";
  const assumptions = $("assumptions");
  assumptions.replaceChildren();
  for (const service of plan.services) {
    const part = node("div");
    part.append(
      node("h3", service.name),
      node(
        "p",
        service.replicas +
          " current / " +
          service.maxReplicas +
          " max · " +
          service.processes +
          " processes per replica",
      ),
      node(
        "p",
        "Rollout surge: " +
          service.surge.value +
          (service.surge.type === "percent"
            ? "% (rounded up)"
            : " fixed replicas"),
      ),
    );
    for (const pool of service.pools)
      part.append(
        node(
          "p",
          pool.id +
            ": " +
            pool.size +
            " per " +
            pool.per +
            " → " +
            pool.resourceId,
        ),
      );
    assumptions.append(part);
  }
  renderSelection();
}
function markSelection() {
  document
    .querySelectorAll("#matrix button")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(
          Number(button.dataset.x) === x && Number(button.dataset.y) === y,
        ),
      ),
    );
}
function renderSelection() {
  const selected = scenario();
  $("selection-title").textContent =
    plan.axes.x + " " + x + " / " + plan.axes.y + " " + y;
  $("selection-status").textContent =
    selected.status.replaceAll("-", " ") + " · " + phase;
  $("selection-status").className =
    "status " + (selected.status === "over-budget" ? "over" : "within");
  for (const axis of ["x", "y"]) {
    $(axis + "-range").value = axis === "x" ? x : y;
    $(axis + "-value").value = axis === "x" ? x : y;
  }
  const target = $("selected-resources");
  target.replaceChildren();
  for (const r of selected.resources) {
    const part = node("div", undefined, "resource-detail");
    part.append(
      node("h3", plan.resources.find((row) => row.id === r.id).name),
      node("strong", String(r.total), r.remaining < 0 ? "over" : "within"),
      node(
        "small",
        " / " + r.limit + " total · " + signed(r.remaining) + " remaining",
      ),
      node(
        "p",
        r.serviceConnections +
          " service + " +
          r.reserved +
          " reserved + " +
          r.other +
          " other",
        "equation",
      ),
    );
    target.append(part);
  }
  const contributions = $("contributions");
  contributions.replaceChildren();
  for (const service of selected.contributions) {
    const part = node("div", undefined, "contribution");
    part.append(
      node(
        "strong",
        plan.services.find((s) => s.id === service.serviceId).name,
      ),
      node(
        "p",
        service.replicas +
          " target + " +
          service.surgeReplicas +
          " surge = " +
          service.totalReplicas +
          " concurrent replicas",
      ),
    );
    for (const p of service.pools)
      part.append(
        node(
          "p",
          p.id +
            ": " +
            p.holders +
            " " +
            p.per +
            " pool holders × " +
            p.size +
            " = " +
            p.connections +
            " → " +
            p.resourceId,
        ),
      );
    contributions.append(part);
  }
  $("announcement").textContent =
    "Selected " +
    plan.axes.x +
    " " +
    x +
    ", " +
    plan.axes.y +
    " " +
    y +
    ". " +
    selected.status +
    ".";
}
for (const name of ["steady", "rollout"])
  $(name).addEventListener("click", () => {
    phase = name;
    render();
  });
$("resource").addEventListener("change", () => {
  resource = $("resource").value;
  render();
});
for (const axis of ["x", "y"])
  $(axis + "-range").addEventListener("input", () => {
    if (axis === "x") x = Number($("x-range").value);
    else y = Number($("y-range").value);
    renderSelection();
    markSelection();
  });
function edit() {
  $("plan-source").value = JSON.stringify(plan, null, 2);
  $("editor-error").hidden = true;
  $("editor").showModal();
  $("plan-source").focus();
}
$("edit").addEventListener("click", edit);
$("edit-assumptions").addEventListener("click", edit);
$("close-editor").addEventListener("click", () => $("editor").close());
$("editor-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const next = validatePlan(parseJson($("plan-source").value));
    plan = next;
    resetSelection();
    render();
    $("editor").close();
    $("error").hidden = true;
  } catch (error) {
    $("editor-error").textContent = error.message;
    $("editor-error").hidden = false;
  }
});
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files[0];
  $("import-file").value = "";
  if (!file) return;
  try {
    if (file.size > 256 * 1024) throw Error("Plan file exceeds 256 KiB.");
    const next = validatePlan(
      parseJson(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        ),
      ),
    );
    plan = next;
    resetSelection();
    render();
    $("error").hidden = true;
  } catch (error) {
    fail(error);
  }
});
$("export-plan").addEventListener("click", () =>
  download(
    "poolgrid-plan.json",
    JSON.stringify(plan, null, 2) + "\n",
    "application/json",
  ),
);
$("export-snapshot").addEventListener("click", () =>
  download(
    "poolgrid-snapshot.json",
    JSON.stringify(
      { version: 1, plan, analysis: analyzePlan(plan), selected: scenario() },
      null,
      2,
    ) + "\n",
    "application/json",
  ),
);
$("export-md").addEventListener("click", () =>
  download("poolgrid.md", toMarkdown(plan), "text/markdown"),
);
resetSelection();
render();
