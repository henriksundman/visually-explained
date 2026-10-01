# Real Data for Visual Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hosts pass `datasets?: Record<string, unknown>` to any render entry point; blocks carrying `dataset: "key"` materialize their data fields from the validated payload at render time, degrading to literal fields with a warning on miss/invalid.

**Architecture:** `RenderContext` gains `datasets`; one shared resolver (`src/core/datasets.ts`: `resolveDataset` + `applyDatasetFields` + the three exported dataset schemas) does lookup/warn/validate; each of the three visual primitives adds a guarded merge at the top of its render. The render pipeline (`render.ts`, `renderDocument.ts`) threads the option; React components pass it through `renderBlock`.

**Tech Stack:** TypeScript, zod (existing dep), vitest, tsup, zero-dependency demo server.

**Spec:** `docs/superpowers/specs/2026-10-01-real-data-visual-blocks-design.md`

**Branch:** `feature/real-data-blocks` (already created from `main` @ `4703f8d`). Commit the plan file itself as the first commit.

## Global Constraints

- **No new runtime deps** — `zod` and `roughjs` stay the only ones.
- **No LLM-surface changes** (backlog pin) — `BLOCK_TYPE_DOCS`, compiler prompts, and `explanationJsonSchema`/`documentJsonSchema` exports are untouched.
- **Leniency:** key miss or invalid payload → warning + literal render. **Never a throw — not even under `strict: true`** (dataset failures are block-level salvage, not document-level diagnostics).
- **Byte-identical without the option:** no `datasets` option → output identical to today, no warnings. Existing suite must pass unchanged throughout.
- **Field-by-field override:** validated dataset fields win over literals; fields the dataset omits keep the literal. Required cores: chart `{ kind, points }`, callout `{ metric, label }`, timeline `{ events }`.
- **Warning format:** `[dataset] <type> <id>: no dataset named "<key>"` and `[dataset] <type> <id>: invalid payload — <issues>`.
- **Dataset payloads validated by per-block-type dataset schemas** that reuse the block schemas' own field definitions (`.shape.*`) so constraints cannot drift.
- **TDD:** behavior-changing tasks get a RED run before the fix. Contract locks labeled as such may pass immediately.
- **Commits:** one per task, conventional style, `🤖 Generated with Codebuff` + `Co-Authored-By: Codebuff <noreply@codebuff.com>` footer. No pushing.
- **Demo contract:** verify against a fresh `npm run build`; restart the launchd server (`explanations-demo`) after rebuilds.

---

### Task 1: Dataset schemas, resolver, `RenderContext`, pipeline threading

**Files:**
- Create: `src/core/datasets.ts`
- Modify: `src/core/registry.ts` (RenderContext)
- Modify: `src/core/render.ts` (RenderOptions + threading)
- Modify: `src/index.ts` (one export)
- Test: `tests/datasets.test.ts` (new)

**Interfaces:**
- Consumes: `RenderContext` from `./registry`; zod; existing block schemas `chartBlockSchema`, `dataCalloutBlockSchema`, `timelineBlockSchema` from `./schema`.
- Produces (used by Tasks 2–4):
  - `chartDatasetSchema`, `dataCalloutDatasetSchema`, `timelineDatasetSchema` (exported zod object schemas)
  - `resolveDataset<T>(ctx: RenderContext, type: string, id: string | undefined, key: string, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false }` — emits the warning itself on failure
  - `applyDatasetFields<T extends object>(block: T, data: Record<string, unknown>): T` — spread of only the dataset's defined fields over the block
  - `RenderContext.datasets?: Record<string, unknown>`; `RenderOptions.datasets?`; `renderBlock(type, data, depth?, opts?)` where `opts.datasets?` is honored

- [ ] **Step 1: Commit the plan file**

```bash
git add docs/superpowers/plans/2026-10-01-real-data-blocks.md
git commit -m "$(cat <<'EOF'
Add implementation plan for real data in visual blocks

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

- [ ] **Step 2: Write the failing tests**

Create `tests/datasets.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  resolveDataset,
  applyDatasetFields,
  chartDatasetSchema,
  dataCalloutDatasetSchema,
  timelineDatasetSchema,
} from "../src/core/datasets"
import { chartBlockSchema } from "../src/core/schema"
import type { RenderContext } from "../src/core/registry"

const ctx = (datasets?: Record<string, unknown>): RenderContext => ({
  depth: 1,
  sketch: false,
  datasets,
  addWarning: m => warnings.push(m),
  renderChildren: () => "",
})
let warnings: string[] = []
const fresh = () => {
  warnings = []
  return warnings
}

describe("dataset schemas", () => {
  it("accept payloads shaped like the block's data fields", () => {
    expect(
      chartDatasetSchema.safeParse({ kind: "bar", points: [{ label: "Mon", value: 4 }] }).success,
    ).toBe(true)
    expect(
      dataCalloutDatasetSchema.safeParse({ metric: "12", label: "deploys", series: [1, 2, 3] }).success,
    ).toBe(true)
    expect(timelineDatasetSchema.safeParse({ events: [{ when: "2024", what: "launch" }] }).success).toBe(true)
  })

  it("keeps the dataset key on an otherwise-valid chart block", () => {
    const parsed = chartBlockSchema.safeParse({
      id: "c1",
      type: "chart",
      kind: "bar",
      points: [{ label: "Mon", value: 4 }],
      dataset: "weekly-deploys",
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.dataset).toBe("weekly-deploys")
  })
})

describe("resolveDataset", () => {
  it("returns validated data on a key hit", () => {
    const w = fresh()
    const r = resolveDataset(ctx({ k: { kind: "line", points: [{ label: "a", value: 1 }] } }), "chart", "c1", "k", chartDatasetSchema)
    expect(r).toEqual({ ok: true, data: { kind: "line", points: [{ label: "a", value: 1 }] } })
    expect(w).toEqual([])
  })

  it("warns with the block id on a key miss and on an invalid payload", () => {
    const w = fresh()
    expect(resolveDataset(ctx({}), "chart", "c1", "nope", chartDatasetSchema).ok).toBe(false)
    expect(w).toEqual([`[dataset] chart c1: no dataset named "nope"`])
    const w2 = fresh()
    expect(resolveDataset(ctx({ k: { kind: "pie" } }), "chart", "c1", "k", chartDatasetSchema).ok).toBe(false)
    expect(w2[0]).toMatch(/^\[dataset\] chart c1: invalid payload — /)
  })

  it("says the type when the block has no id", () => {
    const w = fresh()
    resolveDataset(ctx({}), "timeline", undefined, "nope", timelineDatasetSchema)
    expect(w).toEqual([`[dataset] timeline nope: no dataset named "nope"`])
  })
})

describe("applyDatasetFields", () => {
  it("overrides defined fields and keeps literals for omitted ones", () => {
    const block = { kind: "bar", unit: "ms", caption: "old", points: [{ label: "a", value: 1 }] }
    const merged = applyDatasetFields(block, { kind: "line", points: [{ label: "b", value: 2 }], unit: undefined })
    expect(merged).toEqual({ kind: "line", unit: "ms", caption: "old", points: [{ label: "b", value: 2 }] })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/datasets.test.ts`
Expected: FAIL — `Cannot find module '../src/core/datasets'`.

- [ ] **Step 4: Create `src/core/datasets.ts`**

```ts
import type { z } from "zod"
import type { RenderContext } from "./registry"
import { chartBlockSchema, dataCalloutBlockSchema, timelineBlockSchema } from "./schema"

/** Dataset payloads are shaped like their block's DATA fields only (no id,
 *  type, or dataset). Field definitions are reused from the block schemas so
 *  constraints cannot drift (spec §3). */
export const chartDatasetSchema = z.object({
  kind: chartBlockSchema.shape.kind,
  points: chartBlockSchema.shape.points,
  unit: chartBlockSchema.shape.unit,
  caption: chartBlockSchema.shape.caption,
})

export const dataCalloutDatasetSchema = z.object({
  metric: dataCalloutBlockSchema.shape.metric,
  label: dataCalloutBlockSchema.shape.label,
  delta: dataCalloutBlockSchema.shape.delta,
  trend: dataCalloutBlockSchema.shape.trend,
  series: dataCalloutBlockSchema.shape.series,
  context: dataCalloutBlockSchema.shape.context,
})

export const timelineDatasetSchema = z.object({
  events: timelineBlockSchema.shape.events,
})

export type DatasetResolution<T> = { ok: true; data: T } | { ok: false }

/** Look up a block's dataset, validate it against the type's dataset schema,
 *  and emit a lenient warning on miss/invalid (never a throw — block-level
 *  salvage, even under strict). Own-property guard: a host record must not
 *  resolve "constructor"/"__proto__" to inherited values. */
export function resolveDataset<T>(
  ctx: RenderContext,
  type: string,
  id: string | undefined,
  key: string,
  schema: z.ZodType<T>,
): DatasetResolution<T> {
  const label = id ?? key
  const datasets = ctx.datasets
  if (!datasets || !Object.hasOwn(datasets, key)) {
    ctx.addWarning(`[dataset] ${type} ${label}: no dataset named "${key}"`)
    return { ok: false }
  }
  const parsed = schema.safeParse(datasets[key])
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
    ctx.addWarning(`[dataset] ${type} ${label}: invalid payload — ${issues}`)
    return { ok: false }
  }
  return { ok: true, data: parsed.data }
}

/** Field-by-field override: the dataset's DEFINED fields win; fields it
 *  omits keep the block's literal values (spec §2.4). */
export function applyDatasetFields<T extends object>(block: T, data: Record<string, unknown>): T {
  const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
  return { ...block, ...defined } as T
}
```

Note: the import of `z` is type-only; `z.object` comes from the schemas' own construction — add `import { z } from "zod"` (value import) at the top since `z.object` is called here:

```ts
import { z } from "zod"
```

(replace the type-only z import — the file needs the value).

- [ ] **Step 5: Add `datasets` to `RenderContext`**

In `src/core/registry.ts`, inside `RenderContext` after the `sketch` field:

```ts
  /** Host datasets for blocks carrying a `dataset` key (real-data spec §4). */
  datasets?: Record<string, unknown>
```

- [ ] **Step 6: Thread `datasets` through `src/core/render.ts`**

Four edits:

(a) In `RenderOptions`, after the `root` field doc comment block:

```ts
  /** Host-supplied datasets for blocks carrying a `dataset` key. */
  datasets?: Record<string, unknown>
```

(b) In `renderExplanation`, the blocks map:

```ts
    salvaged.blocks.map(b => renderSalvagedBlock(b, 1, warnings, opts.sketch ?? false, opts.datasets)).join("")
```

(c) In `renderBlock`, the opts type and the call:

```ts
export function renderBlock(type: string, data: unknown, depth = 1, opts: { sketch?: boolean; datasets?: Record<string, unknown> } = {}): string {
```
```ts
  return renderSalvagedBlock(b, depth, [], opts.sketch ?? false, opts.datasets)
```

(d) `renderSalvagedBlock` and `renderChildrenLenient`:

```ts
export function renderSalvagedBlock(b: SalvagedBlock, depth: number, warnings: string[], sketch: boolean, datasets?: Record<string, unknown>): string {
  if (b.kind === "invalid") return ""
  const entry = registry[b.type]
  if (b.kind === "unknown" || !entry) return renderFallback(b.type, b.data)
  const ctx: RenderContext = {
    depth,
    sketch,
    datasets,
    addWarning: m => warnings.push(m),
    renderChildren: (children, d) => renderChildrenLenient(children, d ?? depth + 1, warnings, sketch, datasets),
  }
  return entry.render(b.data as Block, ctx)
}
```
```ts
function renderChildrenLenient(children: unknown[], depth: number, warnings: string[], sketch: boolean, datasets?: Record<string, unknown>): string {
  const diagnostics: Diagnostic[] = []
  const blocks = children.map((raw, i) => salvageBlock(raw, i, diagnostics))
  for (const d of diagnostics) warnings.push(`[${d.code}] ${d.message}`)
  return blocks.map(b => renderSalvagedBlock(b, depth, warnings, sketch, datasets)).join("")
}
```

- [ ] **Step 7: Export from the package root**

In `src/index.ts`, after `export * from "./core/renderDocument"`:

```ts
export * from "./core/datasets"
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/datasets.test.ts`
Expected: PASS — 5/5. (Amendment: the "keeps the dataset key" schema test moved to Task 2 — it needs the schema key Task 2 adds.)

- [ ] **Step 9: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit && echo OK`
Expected: 296/296 tests (291 existing + 5 new — all existing green unchanged proves the no-option path is untouched), tsc clean.

- [ ] **Step 10: Commit**

```bash
git add src/core/datasets.ts src/core/registry.ts src/core/render.ts src/index.ts tests/datasets.test.ts
git commit -m "$(cat <<'EOF'
feat(core): dataset registry plumbing — schemas, resolver, RenderContext

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 2: Chart primitive consumes datasets

**Files:**
- Modify: `src/core/schema.ts` (add `dataset` to `chartBlockSchema`)
- Modify: `src/primitives/chart.ts`
- Test: `tests/chart.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `resolveDataset`, `applyDatasetFields`, `chartDatasetSchema` (Task 1); `chartBlockSchema` gains `dataset?: string`.
- Produces: chart blocks with a resolvable `dataset` render true data. Tasks 3–4 mirror this exact merge pattern.

- [ ] **Step 1: Write the failing tests**

Append to `tests/chart.test.ts`:

```ts
const deploysDataset = {
  kind: "bar" as const,
  points: [
    { label: "Mon", value: 4 },
    { label: "Tue", value: 9, tip: "Deploy day" },
  ],
  unit: "deploys",
}

describe("chart datasets", () => {
  it("renders dataset numbers over literal fields", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "deploys" }],
    }, { datasets: { deploys: deploysDataset } })
    expect(html).toContain(">4deploys</text>")
    expect(html).toContain(`data-tip="Deploy day"`)
    expect(html).not.toContain(">120")
    expect(warnings).toEqual([])
  })

  it("keeps literals for fields the dataset omits", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], unit: "ms", caption: "kept", dataset: "partial" }],
    }, { datasets: { partial: { kind: "bar", points: [{ label: "Mon", value: 7 }] } } })
    expect(html).toContain(">7")
    expect(html).toContain("kept</p>")
    expect(html).toContain(">7ms</text>")
  })

  it("warns and renders literals on a key miss", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "nope" }],
    })
    expect(html).toContain(">120")
    expect(warnings).toEqual([`[dataset] chart dep: no dataset named "nope"`])
  })

  it("warns and renders literals on an invalid payload", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "bad" }],
    }, { datasets: { bad: { kind: "pie" } } })
    expect(html).toContain(">120")
    expect(warnings[0]).toMatch(/^\[dataset\] chart dep: invalid payload — /)
  })

  it("never throws under strict for a dataset miss", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "nope" }],
    }, { strict: true })
    expect(html).toContain(">120")
    expect(warnings).toHaveLength(1)
  })

  it("applies per-point salvage to dataset points", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "mixed" }],
    }, { datasets: { mixed: { kind: "bar", points: [{ label: "ok", value: 1 }, { label: "bad" }, "junk"] } } })
    expect(warnings.filter(w => w.includes("figure-point-invalid"))).toHaveLength(2)
    expect((html.match(/>ok<\/text>/g) ?? []).length).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/chart.test.ts`
Expected: FAIL — the schema now must accept `dataset` first? No: Task 1 did not touch block schemas, so `chartBlockSchema.safeParse` strips/`dataset` is stripped? zod object non-strict STRIPS unknown keys — the block parses but the key is lost, so renders ignore datasets: the two override tests fail (`>4deploys` missing, `>120` present), miss/invalid tests fail on warning text (no warning emitted). That's the correct RED: 6 failing tests, 2 existing pass.

- [ ] **Step 3: Add `dataset` to `chartBlockSchema`**

In `src/core/schema.ts`, `chartBlockSchema` — add before `presentation` (or after `caption`):

```ts
  dataset: z.string().min(1).optional(),
```

- [ ] **Step 4: Wire the merge into `src/primitives/chart.ts`**

Add import:

```ts
import { resolveDataset, applyDatasetFields, chartDatasetSchema } from "../core/datasets"
```

`renderChart` becomes (first lines changed, rest identical with `block` → `b`):

```ts
export function renderChart(block: ChartBlock, ctx: RenderContext): string {
  const warnings: string[] = []
  let b: ChartBlock = block
  if (block.dataset) {
    const r = resolveDataset(ctx, "chart", block.id, block.dataset, chartDatasetSchema)
    if (r.ok) b = applyDatasetFields(block, r.data)
  }
  const points = parsePoints(b.points, warnings)
  for (const w of warnings) ctx.addWarning(w)
  if (points.length === 0) {
    return `<div class="exp-block exp-chart"><p class="exp-fig-empty">Chart data could not be read.</p></div>`
  }
  const { scene } = layoutChart({ kind: b.kind, points, unit: b.unit, caption: b.caption })
  const aria = b.caption ?? `Chart: ${points.map(p => p.label).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria, sketch: ctx.sketch, seed: b.id ?? hashSeed(aria) })
  const caption = b.caption ? `<p class="exp-fig-caption">${renderInline(b.caption)}</p>` : ""
  return `<div class="exp-block exp-chart">${svg}${caption}</div>`
}
```

- [ ] **Step 5: Run to verify GREEN**

Run: `npx vitest run tests/chart.test.ts tests/datasets.test.ts`
Expected: PASS — 13/13 chart-file tests (7 existing + 6 new) + 6/6 datasets.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit && echo OK`
Expected: 303/303, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/schema.ts src/primitives/chart.ts tests/chart.test.ts
git commit -m "$(cat <<'EOF'
feat(chart): materialize blocks from host datasets at render time

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 3: Data-callout + timeline primitives consume datasets

**Files:**
- Modify: `src/core/schema.ts` (add `dataset` to `dataCalloutBlockSchema`, `timelineBlockSchema`)
- Modify: `src/primitives/data-callout.ts`, `src/primitives/timeline.ts`
- Test: `tests/datasets-primitives.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 resolver/schemas; Task 2 merge pattern; `dataCalloutDatasetSchema`, `timelineDatasetSchema`.
- Produces: all three backlog visual block types honor `datasets`.

- [ ] **Step 1: Write the failing tests**

Create `tests/datasets-primitives.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("data-callout datasets", () => {
  it("materializes metric, series, and context from the dataset", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "data-callout", id: "dc", metric: "0", label: "placeholder", dataset: "deploys" }],
    }, {
      datasets: {
        deploys: { metric: "42", label: "deploys last week", trend: "up", series: [3, 5, 8, 13], context: "From CI." },
      },
    })
    expect(html).toContain(`class="exp-metric">42<`)
    expect(html).toContain("deploys last week")
    expect(html).toContain("exp-spark-box")
    expect(html).toContain("From CI.")
    expect(html).not.toContain(`>0<`)
    expect(warnings).toEqual([])
  })

  it("keeps literal fields the dataset omits and warns on a miss", () => {
    const partial = renderExplanation({
      version: 1,
      blocks: [{ type: "data-callout", id: "dc", metric: "9", label: "kept", delta: "+2", dataset: "p" }],
    }, { datasets: { p: { metric: "77", label: "overridden" } } })
    expect(partial.html).toContain(`class="exp-metric">77<`)
    expect(partial.html).toContain("overridden") // dataset-defined label wins
    expect(partial.html).toContain("+2") // delta omitted by the dataset → literal kept
    expect(partial.html).not.toContain("kept")

    const miss = renderExplanation({
      version: 1,
      blocks: [{ type: "data-callout", id: "dc", metric: "9", label: "kept", dataset: "nope" }],
    })
    expect(miss.html).toContain(`class="exp-metric">9<`)
    expect(miss.warnings).toEqual([`[dataset] data-callout dc: no dataset named "nope"`])
  })
})

describe("timeline datasets", () => {
  const events = [
    { when: "2024-01", what: "Design", tip: "Kickoff" },
    { when: "2024-06", what: "Launch" },
  ]

  it("materializes events from the dataset", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "timeline", id: "tl", events: [{ when: "x", what: "guessed" }], dataset: "milestones" }],
    }, { datasets: { milestones: { events } } })
    expect(html).toContain("2024-01")
    expect(html).toContain(`data-tip="Kickoff"`)
    expect(html).not.toContain("guessed")
    expect(warnings).toEqual([])
  })

  it("warns and renders literal events on a miss", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "timeline", id: "tl", events: [{ when: "x", what: "guessed" }], dataset: "nope" }],
    })
    expect(html).toContain("guessed")
    expect(warnings).toEqual([`[dataset] timeline tl: no dataset named "nope"`])
  })
})
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/datasets-primitives.test.ts`
Expected: FAIL — 4 failures (dataset key stripped by schema → literals render, warnings empty).

- [ ] **Step 3: Add `dataset` to the two schemas**

In `src/core/schema.ts` — `dataCalloutBlockSchema` gains after `context`:

```ts
  dataset: z.string().min(1).optional(),
```

and `timelineBlockSchema` gains after `presentation`:

```ts
  dataset: z.string().min(1).optional(),
```

- [ ] **Step 4: Wire the merges**

`src/primitives/data-callout.ts` — add import and merge (rest of the file unchanged with `block` → `b`):

```ts
import { resolveDataset, applyDatasetFields, dataCalloutDatasetSchema } from "../core/datasets"
```

```ts
export function renderDataCallout(block: DataCalloutBlock, ctx: RenderContext): string {
  let b: DataCalloutBlock = block
  if (block.dataset) {
    const r = resolveDataset(ctx, "data-callout", block.id, block.dataset, dataCalloutDatasetSchema)
    if (r.ok) b = applyDatasetFields(block, r.data)
  }
  const spark = resolveSparkline(b)
  const sparkSvg = spark
    ? sceneToSvg(spark.scene, { ariaLabel: spark.aria, sketch: ctx.sketch, seed: spark.seed })
    : ""
  const delta = b.delta
    ? `<span class="exp-delta${b.trend ? ` exp-delta-${b.trend}` : ""}">${escapeHtml(b.delta)}</span>`
    : ""
  const context = b.context ? `<p class="exp-context">${renderInline(b.context)}</p>` : ""
  return (
    `<div class="exp-block exp-data-callout">` +
    `<span class="exp-metric">${escapeHtml(b.metric)}</span>` +
    `<span class="exp-metric-label">${renderInline(b.label)}</span>` +
    delta +
    (sparkSvg ? `<div class="exp-spark-box">${sparkSvg}</div>` : "") +
    context +
    `</div>`
  )
}
```

(`resolveSparkline(block)` → `resolveSparkline(b)`; keep its body as-is.)

`src/primitives/timeline.ts` — add import and merge:

```ts
import { resolveDataset, applyDatasetFields, timelineDatasetSchema } from "../core/datasets"
```

```ts
export function renderTimeline(block: TimelineBlock, ctx: RenderContext): string {
  let b: TimelineBlock = block
  if (block.dataset) {
    const r = resolveDataset(ctx, "timeline", block.id, block.dataset, timelineDatasetSchema)
    if (r.ok) b = applyDatasetFields(block, r.data)
  }
  if (resolvePresentation(b) === "text") return renderTextForm(b)
  const { scene } = layoutTimeline(b.events.map(e => ({ when: e.when, what: e.what, tip: e.tip })))
  const aria = `Timeline: ${b.events.map(e => `${e.when} ${e.what}`).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria, sketch: ctx.sketch, seed: b.id ?? hashSeed(aria) })
  return `<div class="exp-block exp-timeline exp-timeline-figure">${svg}</div>`
}
```

- [ ] **Step 5: Run to verify GREEN**

Run: `npx vitest run tests/datasets-primitives.test.ts`
Expected: PASS — 4/4.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit && echo OK`
Expected: 307/307, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/schema.ts src/primitives/data-callout.ts src/primitives/timeline.ts tests/datasets-primitives.test.ts
git commit -m "$(cat <<'EOF'
feat(primitives): dataset materialization for data-callout and timeline

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 4: React pass-through + entry-point parity

**Files:**
- Modify: `src/react/Explanation.tsx`, `src/react/Document.tsx`
- Test: `tests/datasets-react.test.tsx` (new)

**Interfaces:**
- Consumes: `renderBlock` opts now `{ sketch?, datasets? }` (Task 1); `renderDocument` already honors `datasets` (Task 1 threading).
- Produces: `<Explanation datasets>` and `<Document datasets>` with HTML/React parity.

- [ ] **Step 1: Write the failing tests**

Create `tests/datasets-react.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { renderDocument } from "../src/core/renderDocument"
import { Explanation, Document } from "../src/react"
import "../src/core/registerAll"

const chartBlock = {
  type: "chart",
  id: "dep",
  kind: "bar",
  points: [{ label: "Mon", value: 120 }],
  dataset: "deploys",
}
const datasets = { deploys: { kind: "bar", points: [{ label: "Mon", value: 4 }] } }
const docIr = {
  version: 1,
  title: "Doc",
  sections: [{ title: "S", blocks: [chartBlock] }],
}

describe("datasets entry-point parity", () => {
  it("renderDocument resolves datasets", () => {
    const { html } = renderDocument(docIr, { datasets })
    expect(html).toContain(">4</text>")
    expect(html).not.toContain(">120")
  })

  it("<Explanation> resolves datasets", () => {
    const html = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [chartBlock] }} datasets={datasets} />,
    )
    expect(html).toContain(">4</text>")
    expect(html).not.toContain(">120")
  })

  it("<Document> resolves datasets", () => {
    const html = renderToStaticMarkup(<Document ir={docIr} datasets={datasets} />)
    expect(html).toContain(">4</text>")
    expect(html).not.toContain(">120")
  })

  it("react output matches the html renderer's dataset numbers", () => {
    const { html } = renderDocument(docIr, { theme: "none", datasets })
    const react = renderToStaticMarkup(<Document ir={docIr} theme="none" datasets={datasets} />)
    expect(react).toContain(">4</text>")
    expect(html).toContain(">4</text>")
  })
})
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/datasets-react.test.tsx`
Expected: FAIL — 3 React failures (`datasets` not a known prop → ignored → `>120` renders). The `renderDocument` test PASSES already (Task 1 threading) — that's the contract-lock style anchor; the three React tests are the RED.

- [ ] **Step 3: Thread the prop through the React components**

`src/react/Explanation.tsx` — add to `ExplanationProps` after `sketch`:

```tsx
  /** Host-supplied datasets for blocks carrying a `dataset` key. */
  datasets?: Record<string, unknown>
```

add `datasets,` to the destructured props, and change every `renderBlock(b.type, b.data, 1, { sketch })` call (three occurrences: FigureEvents branch and the two fallbacks) to:

```tsx
renderBlock(b.type, b.data, 1, { sketch, datasets })
```

`src/react/Document.tsx` — add to `DocumentProps` after `sketch`:

```tsx
  /** Host-supplied datasets for blocks carrying a `dataset` key. */
  datasets?: Record<string, unknown>
```

add `datasets = undefined,` to the destructured props (default keeps arity stable), and change the block render call:

```tsx
<div key={bi} dangerouslySetInnerHTML={{ __html: renderBlock(type, raw, 1, { sketch, datasets }) }} />
```

Note: `datasets = undefined` in destructuring — just add `datasets,` (no default needed; undefined passes through `renderBlock`'s optional cleanly).

- [ ] **Step 4: Run to verify GREEN**

Run: `npx vitest run tests/datasets-react.test.tsx`
Expected: PASS — 4/4.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit && echo OK`
Expected: 311/311, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/react/Explanation.tsx src/react/Document.tsx tests/datasets-react.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): datasets prop on Explanation and Document

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 5: Demo section, README, ROADMAP, verification

**Files:**
- Modify: `demo/examples.js` (dataset-driven section in `demoDocIr`)
- Modify: `demo/server.mjs` (pass `datasets` on the `/document` route)
- Modify: `README.md`, `docs/ROADMAP.md`
- Modify: `.superpowers/sdd/progress.md` (git-ignored ledger — no commit)

**Interfaces:**
- Consumes: shipped Tasks 1–4. Produces: docs + demo only.

- [ ] **Step 1: Demo IR — add a dataset-driven section**

In `demo/examples.js`, find the `demoDocIr` export and append a new section object as the LAST entry of its `sections` array (read the file first to locate the exact closing of the last section):

```js
  {
    title: "Real data",
    blocks: [
      { type: "text", body: "The same chart block twice: the first one carries a `dataset` key, so its numbers come from the host — not from the model. The second is the literal IR, model-guessed." },
      { type: "chart", id: "deploys-true", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "weekly-deploys" },
      { type: "chart", id: "deploys-guessed", kind: "bar", points: [{ label: "Mon", value: 120 }] },
      { type: "timeline", id: "milestones-true", events: [{ when: "someday", what: "model-guessed" }], dataset: "milestones" },
    ],
  },
```

**Also:** `tests/demo-examples.test.ts` asserts `demoDocIr` renders exactly 4
sections (`toHaveLength(4)` on `class="exp-doc-section"`). Update that count
to 5 — the new "Real data" section is intentional. This is a plan-test fix,
not a regression.

- [ ] **Step 2: Demo server — pass the datasets option**

In `demo/server.mjs`, the `/document` route:

```js
    const { html } = renderDocument(demoDocIr, { theme: "none" })
```
→
```js
    const { html } = renderDocument(demoDocIr, {
      theme: "none",
      datasets: {
        "weekly-deploys": {
          kind: "bar",
          unit: "deploys",
          points: [
            { label: "Mon", value: 4 },
            { label: "Tue", value: 9, tip: "Deploy day" },
            { label: "Wed", value: 18 },
            { label: "Thu", value: 11 },
            { label: "Fri", value: 7 },
          ],
        },
        milestones: {
          events: [
            { when: "2024-Q1", what: "Design partners", tip: "Five teams" },
            { when: "2024-Q3", what: "Beta" },
            { when: "2025-Q1", what: "GA", tip: "Host announcement" },
          ],
        },
      },
    })
```

- [ ] **Step 3: README — option tables + Datasets subsection**

In `README.md`:

(a) In the `renderExplanation` options table, after the `root` row add:

```markdown
| `datasets` | — | Keyed host data for blocks carrying a `dataset` key — a miss or invalid payload warns and falls back to the block's literal fields |
```

(b) In the `renderDocument` options table, after the `tocSticky` row add the same row.

(c) In `## Block types`, after the visuals list paragraph (the line ending `` `figure` ``), add:

```markdown
Host data, not model guesses: `chart`, `data-callout`, and `timeline` accept
`dataset: "<key>"`. At render time the key is looked up in the `datasets`
option and the validated payload's fields override the block's literals
(omitted fields keep the literal). A missing key or invalid payload warns and
renders the literal fields — never a failed render. Payload schemas are
exported for pre-validation: `chartDatasetSchema`, `dataCalloutDatasetSchema`,
`timelineDatasetSchema`.

```ts
renderDocument(ir, { datasets: { "weekly-deploys": { kind: "bar", unit: "deploys", points: [...] } } })
```
```

(d) In the codebase map, after the `src/core/` row add:

```markdown
| `src/core/datasets.ts` | Dataset schemas + lenient resolver shared by the visual primitives |
```

- [ ] **Step 4: ROADMAP — shipped bullet + backlog removal**

In `docs/ROADMAP.md`, append to **Shipped** (after the Streaming compile bullet):

```markdown
- **Real data for visual blocks** (2026-10-01) — hosts pass
  `datasets?: Record<string, unknown>` to any render entry point;
  `chart`/`data-callout`/`timeline` blocks carrying `dataset: "<key>"`
  materialize their data fields from the validated payload at render time
  (field-by-field override; miss/invalid → warning + literal fallback, never
  a throw). Exported per-type dataset schemas; LLM surface untouched. Spec:
  `docs/superpowers/specs/2026-10-01-real-data-visual-blocks-design.md`.
```

and delete the backlog bullet:

```markdown
- **Real data for visual blocks** — host-supplied datasets (keyed,
  schema-validated) interpolated into `chart`/`data-callout`/`timeline` at
  render time, so numbers are true instead of model-guessed. Renderer/schema
  work; no LLM-surface changes.
```

- [ ] **Step 5: Full verification**

```bash
npx tsc --noEmit && npx vitest run 2>&1 | grep -E "Test Files|Tests "
npm run build
launchctl remove explanations-demo 2>/dev/null; true
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
sleep 1
curl -s -o /dev/null -w "document:%{http_code} " http://localhost:4173/document
curl -s -o /dev/null -w "compile:%{http_code} " http://localhost:4173/compile
curl -s -o /dev/null -w "root:%{http_code}\n" http://localhost:4173/
curl -s http://localhost:4173/document | grep -c "4deploys"  # dataset value renders; (amendment: block ids don't appear in HTML — grep the dataset-derived value instead)
./scripts/vexp verify
```

Expected: tsc clean; 311/311; build ok; all curls 200; the served `/document` HTML contains the dataset-driven value (`4deploys` → count ≥ 1 — block ids don't render, so grep the value); `vexp verify` clean (run any tests it flags).

**Test-count ledger:** 291 base → Task 1 +5 (296) → Task 2 +7 (303) → Task 3 +4 (307) → Task 4 +4 (311). The demoDocIr section-count assertion changes value but not count.

- [ ] **Step 6: Commit docs + demo**

```bash
git add demo/examples.js demo/server.mjs README.md docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs+demo: dataset-driven visuals on /document and host docs

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

- [ ] **Step 7: Update the progress ledger** (git-ignored — no commit)

Append to `.superpowers/sdd/progress.md`:

```text
Real-data Task 1: complete (datasets.ts resolver + schemas; RenderContext/RenderOptions threading; 6 tests)
Real-data Task 2: complete (chart dataset materialization; 6 tests)
Real-data Task 3: complete (data-callout + timeline materialization; 4 tests)
Real-data Task 4: complete (React datasets prop + parity; 4 tests)
Real-data Task 5: complete (demo section on /document; README/ROADMAP; full verification green)
```

- [ ] **Step 8: Fresh-eyes review pass against the spec**

Re-read `docs/superpowers/specs/2026-10-01-real-data-visual-blocks-design.md` §3–§8 and check each requirement against the shipped code: schema keys, exported schemas, four-case matrix, warning formats, strict non-escalation, determinism (existing suite green), demo, out-of-scope list untouched. Fix discrepancies in a follow-up commit before declaring the branch done.
