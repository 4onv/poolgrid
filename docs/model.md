# Model and file format

Version 1 is a JSON plan. [examples/plan.json](../examples/plan.json) is a complete synthetic input.

## Plan fields

Every listed field is required; unknown fields are rejected.

| Object | Fields |
| --- | --- |
| Plan | `version: 1`, `title`, `description`, `resources`, `services`, `axes` |
| Resource | `id`, `name`, `limit`, `reserved`, `other` |
| Service | `id`, `name`, `replicas`, `maxReplicas`, `processes`, `pools`, `surge` |
| Pool | `id`, `resourceId`, `size`, `per: "process" or "replica"` |
| Surge | `type: "fixed" or "percent"`, `value` |
| Axes | `x`, `y`: two distinct service IDs |

IDs start with an ASCII letter and contain at most 40 ASCII letters, digits, underscores or hyphens. Resource and service IDs are unique within their own lists. Pool IDs are unique within a service; separate pools may target the same resource and are added independently. Every resource reference must exist.

`limit` is the total entered connection ceiling. `reserved` holds capacity aside for administrative or other chosen needs. `other` counts connections outside the listed services. Both are added to the total. Overcommitted reserves are valid input and produce an over-budget result, rather than being silently clamped.

`processes` counts independent processes in one replica. Only `per: "process"` pools multiply by that field. A replica-shared pool has one holder per replica, regardless of process count. Enter all separate pools that count toward a resource; the tool does not identify pool ownership from framework configuration.

## Scenarios

`analyzePlan(plan)` returns four independent calculations:

- `current`: entered current replicas, no surge.
- `currentRollout`: entered current replicas, configured surge.
- `maximum`: every service at its maximum, no surge.
- `maximumRollout`: every service at its maximum, configured surge.

The rollout calculation assumes the configured allowance for **every** service can coexist. For a positive target replica count `n`, extra replicas are `value` for fixed surge, or `ceil(n × value / 100)` for percentage surge. At target zero, extra replicas are zero. This is a chosen arithmetic model, not a model of every deployment platform.

For each pool, holders equal `(n + extra) × processes` for process-local pools, or `n + extra` for replica-shared pools. Connections equal holders × pool size. Each resource sums its own pool contributions and adds reserved + other. Remaining equals limit − total. Equality is within budget. If any resource exceeds its limit, the complete scenario is `over-budget`.

Different old/new pool sizes and processes, draining connections after scale-down, terminating pods outside a scheduler's surge count, failover and duration are outside this model. Enter a sufficient extra-holder allowance, account for those connections in `other`, or use another model. A Kubernetes surge setting is not automatically a complete connection-overlap bound.

`evaluateScenario(plan, {phase, replicas})` accepts `steady` or `rollout` and optional service-ID overrides from zero through each service's maximum. Every omitted service stays at its **maximum**. Unknown options, service IDs and invalid override counts are rejected.

## Matrix and exports

`buildGrid(plan, {phase})` enumerates x replicas from zero to the configured maximum and y replicas likewise. Other services stay at maximum. The row-major `cells` array includes x, y, status and per-resource total/remaining counts. The largest grid is 65 × 65 = 4225 cells.

In the browser, a cell's number is the remaining budget of the selected displayed resource. Its color represents **all** resources, so a positive displayed margin can still accompany an over-budget cell. The selected panel shows each resource and all service/pool contributions.

`Save plan` exports applied plan JSON. `Export snapshot` exports `{version, plan, analysis, selected}`; selection includes its phase and complete replica-count map. The Markdown export contains the four fixed scenarios and entered assumptions, not the transient selected matrix cell. Reopen the saved plan to resume editing; snapshots are reports, not plan inputs.

`poolgrid check` evaluates maximum rollout by default, or maximum steady with `--phase steady`. JSON output includes `checkedScenario` and its `status`, in addition to all four scenarios. Exit 0 means within entered budgets, exit 1 means over budget, and exit 2 means invalid input or an operational error. Other successful commands exit 0, including `matrix` containing over-budget cells.

## Bounds

- 1–4 resources; limit 1–1,000,000; reserved and other each 0–1,000,000.
- 2–8 services; current replicas 0 through maximum replicas; maximum 0–64; processes 1–64.
- 1–8 pools per service; size 0–10,000; fixed surge 0–64; percentage surge 0–200, integer only.
- Title 160 UTF-16 units, description 2000, resource/service names 100; nonblank, well-formed Unicode, no unsupported control characters.
- Canonical normalized plan at most 128 KiB; CLI/browser input file at most 256 KiB. JSON parsing rejects duplicate decoded keys, non-finite numbers and nesting beyond 24 containers; schema validation rejects unknown or missing fields. Byte input is decoded as UTF-8 with a fatal decoder.
- JavaScript APIs reject getters, non-plain objects, sparse arrays, malformed IDs and unsafe numeric coercion. Calculations at supported maxima remain below JavaScript's exact safe-integer bound.

The lower-level `parseJson(text)` reader has a 1 MiB generic parser bound; `validatePlan` and the file readers impose the tighter plan bounds above. It returns null-prototype objects. No mutable caller data is reused in returned calculations.

## Interpretation

The result is a transparent sum, not observed usage, a pool-sizing recommendation, a performance benchmark or approval to deploy. Separate client-side and backend limits when a proxy multiplexes connections. Query throughput, memory, queues, locks, timeouts and database workload are not inferred from connection counts.
