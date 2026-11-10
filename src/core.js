/** Integer arithmetic over explicitly entered connection holders; no live discovery. */
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
function fail(message) {
  throw new TypeError(message);
}
function object(value, fields, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    fail(label + " must be a plain object.");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !fields.includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(value, key)),
    )
  )
    fail(label + " has missing, unknown or accessor fields.");
}
function array(value, min, max, label) {
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    fail(label + " has an invalid array shape or size.");
  for (let i = 0; i < value.length; i++)
    if (
      !Object.hasOwn(value, i) ||
      !("value" in Object.getOwnPropertyDescriptor(value, String(i)))
    )
      fail(label + " has holes or accessors.");
  return value;
}
function text(value, max, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    !value.isWellFormed() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  )
    fail(label + " is invalid text.");
  return value;
}
function id(value) {
  text(value, 40, "ID");
  if (!ID.test(value))
    fail(
      "IDs must start with a letter and use ASCII letters, digits, underscore or hyphen.",
    );
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(label + " is outside its integer bounds.");
  return value;
}
function unique(items, label) {
  if (new Set(items.map((row) => row.id)).size !== items.length)
    fail("Duplicate " + label + " ID.");
}
export function validatePlan(input) {
  object(
    input,
    ["version", "title", "description", "resources", "services", "axes"],
    "Plan",
  );
  if (input.version !== 1) fail("Plan version must be 1.");
  const resources = array(input.resources, 1, 4, "Resources").map((row) => {
    object(row, ["id", "name", "limit", "reserved", "other"], "Resource");
    return {
      id: id(row.id),
      name: text(row.name, 100, "Resource name"),
      limit: integer(row.limit, 1, 1000000, "Limit"),
      reserved: integer(row.reserved, 0, 1000000, "Reserved"),
      other: integer(row.other, 0, 1000000, "Other connections"),
    };
  });
  unique(resources, "resource");
  const resourceIds = new Set(resources.map((row) => row.id));
  const services = array(input.services, 2, 8, "Services").map((row) => {
    object(
      row,
      ["id", "name", "replicas", "maxReplicas", "processes", "pools", "surge"],
      "Service",
    );
    const maxReplicas = integer(row.maxReplicas, 0, 64, "Maximum replicas");
    const pools = array(row.pools, 1, 8, "Pools").map((pool) => {
      object(pool, ["id", "resourceId", "size", "per"], "Pool");
      if (!resourceIds.has(pool.resourceId))
        fail("Pool references an unknown resource.");
      if (!["process", "replica"].includes(pool.per))
        fail("Pool holder must be process or replica.");
      return {
        id: id(pool.id),
        resourceId: pool.resourceId,
        size: integer(pool.size, 0, 10000, "Pool size"),
        per: pool.per,
      };
    });
    unique(pools, "pool");
    object(row.surge, ["type", "value"], "Surge");
    if (!["fixed", "percent"].includes(row.surge.type))
      fail("Surge type must be fixed or percent.");
    return {
      id: id(row.id),
      name: text(row.name, 100, "Service name"),
      replicas: integer(row.replicas, 0, maxReplicas, "Current replicas"),
      maxReplicas,
      processes: integer(row.processes, 1, 64, "Processes"),
      pools,
      surge: {
        type: row.surge.type,
        value: integer(
          row.surge.value,
          0,
          row.surge.type === "fixed" ? 64 : 200,
          "Surge",
        ),
      },
    };
  });
  unique(services, "service");
  object(input.axes, ["x", "y"], "Axes");
  const ids = new Set(services.map((s) => s.id));
  if (
    !ids.has(input.axes.x) ||
    !ids.has(input.axes.y) ||
    input.axes.x === input.axes.y
  )
    fail("Choose two distinct service IDs as axes.");
  const result = {
    version: 1,
    title: text(input.title, 160, "Title"),
    description: text(input.description, 2000, "Description"),
    resources,
    services,
    axes: { x: input.axes.x, y: input.axes.y },
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 128 * 1024)
    fail("Plan exceeds 128 KiB.");
  return result;
}
function phaseName(phase) {
  if (!["steady", "rollout"].includes(phase))
    fail("Phase must be steady or rollout.");
  return phase;
}
function options(value, allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    fail("Options must be a plain object.");
  for (const key of Reflect.ownKeys(value))
    if (
      typeof key !== "string" ||
      !allowed.includes(key) ||
      !("value" in Object.getOwnPropertyDescriptor(value, key))
    )
      fail("Unknown or accessor option.");
}
function calculate(plan, counts, phase) {
  const contributions = plan.services.map((service) => {
    const replicas = counts[service.id];
    // A zero target means no rollout is starting. Fixed surge is an entered bound.
    const extra =
      phase === "rollout" && replicas > 0
        ? service.surge.type === "fixed"
          ? service.surge.value
          : Math.ceil((replicas * service.surge.value) / 100)
        : 0;
    const totalReplicas = replicas + extra;
    return {
      serviceId: service.id,
      replicas,
      surgeReplicas: extra,
      totalReplicas,
      pools: service.pools.map((pool) => {
        const holders =
          totalReplicas * (pool.per === "process" ? service.processes : 1);
        return {
          id: pool.id,
          resourceId: pool.resourceId,
          per: pool.per,
          holders,
          size: pool.size,
          connections: holders * pool.size,
        };
      }),
    };
  });
  const resources = plan.resources.map((resource) => {
    const serviceConnections = contributions.reduce(
      (sum, service) =>
        sum +
        service.pools
          .filter((p) => p.resourceId === resource.id)
          .reduce((n, p) => n + p.connections, 0),
      0,
    );
    const total = resource.reserved + resource.other + serviceConnections;
    return {
      id: resource.id,
      limit: resource.limit,
      reserved: resource.reserved,
      other: resource.other,
      serviceConnections,
      total,
      remaining: resource.limit - total,
      status: total > resource.limit ? "over-budget" : "within-budget",
    };
  });
  return {
    phase,
    replicas: { ...counts },
    status: resources.some((r) => r.status === "over-budget")
      ? "over-budget"
      : "within-budget",
    resources,
    contributions,
  };
}
export function evaluateScenario(input, settings = {}) {
  options(settings, ["phase", "replicas"]);
  const { phase = "rollout", replicas = {} } = settings;
  const plan = validatePlan(input);
  phaseName(phase);
  if (
    !replicas ||
    typeof replicas !== "object" ||
    Array.isArray(replicas) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(replicas))
  )
    fail("Replicas must be an object.");
  const counts = Object.fromEntries(
    plan.services.map((s) => [s.id, s.maxReplicas]),
  );
  for (const key of Reflect.ownKeys(replicas)) {
    if (
      typeof key !== "string" ||
      !Object.hasOwn(counts, key) ||
      !("value" in Object.getOwnPropertyDescriptor(replicas, key))
    )
      fail("Unknown or accessor replica override.");
    counts[key] = integer(
      replicas[key],
      0,
      plan.services.find((s) => s.id === key).maxReplicas,
      "Replica override",
    );
  }
  return calculate(plan, counts, phase);
}
export function analyzePlan(input) {
  const plan = validatePlan(input),
    current = Object.fromEntries(plan.services.map((s) => [s.id, s.replicas])),
    maximum = Object.fromEntries(
      plan.services.map((s) => [s.id, s.maxReplicas]),
    );
  return {
    version: 1,
    title: plan.title,
    model:
      "Entered connection ceilings; rollout assumes all configured surges coexist. No runtime or performance prediction.",
    current: calculate(plan, current, "steady"),
    currentRollout: calculate(plan, current, "rollout"),
    maximum: calculate(plan, maximum, "steady"),
    maximumRollout: calculate(plan, maximum, "rollout"),
  };
}
export function buildGrid(input, settings = {}) {
  options(settings, ["phase"]);
  const { phase = "rollout" } = settings;
  const plan = validatePlan(input);
  phaseName(phase);
  const x = plan.services.find((s) => s.id === plan.axes.x),
    y = plan.services.find((s) => s.id === plan.axes.y);
  const counts = Object.fromEntries(
      plan.services.map((s) => [s.id, s.maxReplicas]),
    ),
    cells = [];
  for (let row = 0; row <= y.maxReplicas; row++)
    for (let column = 0; column <= x.maxReplicas; column++) {
      const result = calculate(
        plan,
        { ...counts, [x.id]: column, [y.id]: row },
        phase,
      );
      cells.push({
        x: column,
        y: row,
        status: result.status,
        resources: result.resources.map((r) => ({
          id: r.id,
          total: r.total,
          remaining: r.remaining,
        })),
      });
    }
  return {
    phase,
    axes: { x: x.id, y: y.id },
    columns: x.maxReplicas + 1,
    rows: y.maxReplicas + 1,
    otherServices: "Held at configured maximum replicas.",
    cells,
  };
}
function md(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, "\\$&")
    .replace(/\r?\n/g, " ");
}
export function toMarkdown(input) {
  const plan = validatePlan(input),
    report = analyzePlan(plan);
  const lines = [
    "# " + md(plan.title),
    "",
    md(plan.description),
    "",
    report.model,
    "",
    "| Scenario | Resource | Counted connections | Limit | Remaining | Result |",
    "| --- | --- | ---: | ---: | ---: | --- |",
  ];
  for (const key of ["current", "currentRollout", "maximum", "maximumRollout"])
    for (const r of report[key].resources)
      lines.push(
        `| ${key} | ${md(r.id)} | ${r.total} | ${r.limit} | ${r.remaining} | ${r.status} |`,
      );
  lines.push(
    "",
    "## Entered pool assumptions",
    "",
    "| Service | Current / max replicas | Processes / replica | Pool | Holder | Size | Resource |",
    "| --- | ---: | ---: | --- | --- | ---: | --- |",
  );
  for (const s of plan.services)
    for (const p of s.pools)
      lines.push(
        `| ${md(s.id)} | ${s.replicas} / ${s.maxReplicas} | ${s.processes} | ${md(p.id)} | ${p.per} | ${p.size} | ${md(p.resourceId)} |`,
      );
  lines.push(
    "",
    "Rollout surge: " +
      plan.services
        .map(
          (s) =>
            md(s.id) +
            ": " +
            s.surge.value +
            (s.surge.type === "percent" ? "% (rounded up)" : " fixed replicas"),
        )
        .join("; ") +
      ".",
    "",
    "Limits and pool sizes must be verified by the operator. Within-budget does not mean a deployment or database is safe. Multiplexed clients and backend connections are separate capacities.",
    "",
  );
  return lines.join("\n");
}
