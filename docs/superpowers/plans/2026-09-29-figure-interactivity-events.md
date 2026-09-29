# Figure Interactivity Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every scene element can carry identity (`id`) + explanation (`tip`); the SVG emit layer exposes both (`data-el-id`/`data-tip`); a delegated React layer turns hits into an `onElementEvent` callback and a built-in themeable popover.

**Architecture:** Identity travels on Scene elements (set by authors via `authored.ts`, derived by layouts); `sceneToSvg` wraps identified elements in `<g class="exp-el" data-el-id data-tip>` uniformly for clean and sketch modes, adding a transparent twin stroke for hairline hit area. React wiring is one shared hook (`useElementPopover`) consumed by both `InteractiveFigure` and a tiny `FigureEvents` client wrapper on the static path — listeners delegate via `closest('.exp-el')`, so there is zero per-element JS.

**Tech Stack:** TypeScript, zod (already present), React 19 peer, vitest. **No new dependencies** (popover positioning is a pure function over two rects; no floating-ui).

**Spec:** `docs/superpowers/specs/2026-09-29-figure-interactivity-events-design.md`

## Global Constraints

- Dependency-free: add NO packages (dev deps included — no jsdom; interaction is verified by browser eyes per house pattern).
- Scene IR never raw SVG: identity is IR data; emit derives attributes only from Scene elements.
- Lenient salvage: invalid identity drops with a warning, never fails a render.
- Determinism: SSR output depends only on IR; popover closed state renders identically server/client.
- Author element ids must match `/^[\w][\w-]*$/` and be ≤100 chars; tips ≤200 chars, non-empty after trim.
- Emit-layer identity check is escape-safe only (`escapeHtml` already escapes `& < > "`), non-empty, ≤100/≤200 — derived ids like `dep->lat` and `bar:Wed` are legal and are NOT regex-checked.
- Untrusted text is only ever rendered via `escapeHtml` (emit) or React text children / `renderInline` (popover).
- CSS is appended to `src/themes/tokens.css` via bash heredoc (large-file write lesson), never a full-file write.
- Test commands run as `npx vitest run <file>; echo "EXIT=$?"` — never pipe through tail/grep (swallows exit codes).
- Commits end with the Codebuff footer; branch `feature/figure-events` is already checked out with the spec committed (`e507ed6`).

---

### Task 1: Scene identity + emit layer (`svg.ts`, `scene.ts`, `sketch.ts`)

**Files:**
- Modify: `src/figures/scene.ts` (add optional identity fields)
- Modify: `src/figures/svg.ts` (wrapper + twin stroke)
- Modify: `src/figures/sketch.ts` (no code change required — verify wrapper covers sketch output; only touch if a test proves otherwise)
- Test: `tests/figures/svg.test.ts`

**Interfaces:**
- Consumes: existing `SceneElement` union and `cleanElement` switch.
- Produces: scene element types accept `id?: string; tip?: string` (except `NodeBoxEl`, which keeps required `id` and gains `tip?`); `sceneToSvg` emits `<g class="exp-el" data-el-id="…" data-tip="…">…</g>` for identified elements, with duplicate ids resolved first-wins. Later tasks rely on: any scene element with `id`/`tip` set is emitted addressable, and elements without identity emit byte-identical SVG to today.

- [ ] **Step 1: Write the failing tests**

Append to `tests/figures/svg.test.ts`:

```ts
describe("element identity (interactivity emit)", () => {
  const identified: Scene = {
    width: 200,
    height: 100,
    elements: [
      {
        kind: "node-box",
        id: "lat",
        tip: "p95 spikes when the deploy lands",
        x: 20,
        y: 20,
        w: 90,
        h: 44,
        shape: "box",
        label: "Latency",
      },
      { kind: "figure-dot", id: "pen", tip: "The pen dot", cx: 50, cy: 50, r: 3, tone: "accent" },
      { kind: "figure-path", id: "wave", d: "M 0 0 L 10 10", tone: "ink", fill: null, width: 2 },
      { kind: "figure-dot", cx: 5, cy: 5, r: 3, tone: "ink" }, // anonymous — untouched
    ],
  }

  it("wraps identified elements with data-el-id and data-tip", () => {
    const svg = sceneToSvg(identified, { ariaLabel: "f" })
    expect(svg).toContain(`<g class="exp-el" data-el-id="lat" data-tip="p95 spikes when the deploy lands" tabindex="0">`)
    expect(svg).toContain(`data-el-id="pen"`)
    expect(svg).toContain(`data-el-id="wave"`)
  })

  it("gives hairline elements a transparent twin stroke inside the wrapper", () => {
    const svg = sceneToSvg(identified, { ariaLabel: "f" })
    expect(svg).toContain(`<path class="exp-el-hit" d="M 0 0 L 10 10" stroke="transparent" stroke-width="12" fill="none" pointer-events="stroke"/>`)
  })

  it("leaves anonymous elements untouched (no exp-el group, no tabindex)", () => {
    const svg = sceneToSvg(
      { width: 100, height: 100, elements: [{ kind: "figure-dot", cx: 5, cy: 5, r: 3, tone: "ink" }] },
      { ariaLabel: "f" },
    )
    expect(svg).not.toContain(`exp-el`)
    expect(svg).not.toContain(`data-el-id`)
    expect(svg).not.toContain(`tabindex`)
  })

  it("tabindex only appears on tip-bearing elements", () => {
    const svg = sceneToSvg(
      { width: 100, height: 100, elements: [{ kind: "figure-dot", id: "d", cx: 5, cy: 5, r: 3, tone: "ink" }] },
      { ariaLabel: "f" },
    )
    expect(svg).toContain(`data-el-id="d"`)
    expect(svg).not.toContain(`tabindex`)
  })

  it("carries identity through the sketch pass", () => {
    const svg = sceneToSvg(identified, { ariaLabel: "f", sketch: true, seed: "s" })
    expect(svg).toContain(`data-el-id="lat"`)
    expect(svg).toContain(`data-el-id="pen"`)
    expect(svg).toContain(`data-el-id="wave"`)
    expect(svg).toContain(`class="exp-fig-sketch"`) // rough strokes still emitted
  })

  it("escapes hostile identity values", () => {
    const svg = sceneToSvg(
      { width: 100, height: 100, elements: [{ kind: "figure-dot", id: 'x"y', tip: "<script>", cx: 5, cy: 5, r: 3, tone: "ink" }] },
      { ariaLabel: "f" },
    )
    expect(svg).toContain(`data-el-id="x&quot;y"`)
    expect(svg).toContain(`data-tip="&lt;script&gt;"`)
    expect(svg).not.toContain("<script>")
  })

  it("first duplicate id wins; later duplicates emit anonymous", () => {
    const svg = sceneToSvg(
      {
        width: 100,
        height: 100,
        elements: [
          { kind: "figure-dot", id: "d", cx: 5, cy: 5, r: 3, tone: "ink" },
          { kind: "figure-dot", id: "d", cx: 20, cy: 20, r: 3, tone: "ink" },
        ],
      },
      { ariaLabel: "f" },
    )
    expect(svg.match(/data-el-id="d"/g)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/figures/svg.test.ts; echo "EXIT=$?"`
Expected: FAIL — `data-el-id` never emitted (`expected ... to contain`).

- [ ] **Step 3: Add identity fields to scene types**

In `src/figures/scene.ts`, add to the top (after the `NodeShape` type):

```ts
/** Element identity for the interactivity layer (spec §4). Set by authors
 *  (authored leaves via compileFigure) or derived by layouts (arrows, chart
 *  points, timeline events). Consumed only by the SVG emit layer. */
export interface SceneIdentity {
  id?: string
  tip?: string
}
```

Then add `id?: string; tip?: string` (a single line: `  id?: string` + `  tip?: string`) to each of these interfaces, and `extends SceneIdentity` is NOT used — plain fields, matching the file's explicit style:

- `NodeBoxEl`: gains only `tip?: string` (its `id: string` stays required)
- `ArrowEl`, `BarEl`, `DotEl`, `LinePathEl`, `SparklineEl`, `LabelEl`, `FigurePathEl`, `FigureBoxEl`, `FigureLineEl`, `FigureDotEl`, `FigureLabelEl`: gain both `id?: string` and `tip?: string`

- [ ] **Step 4: Implement the wrapper + twin stroke in `svg.ts`**

In `src/figures/svg.ts`, add after the `n2` function:

```ts
/** Emit-layer identity gate: escape-safety only. Author ids were already
 *  regex-validated at parse time; derived ids (dep->lat, bar:Wed) are built
 *  from schema-validated strings. escapeHtml makes any of them attribute-safe. */
function hasIdentity(el: SceneElement): boolean {
  return typeof el.id === "string" && el.id !== "" && el.id.length <= 100
}

function hasTip(el: SceneElement): boolean {
  return typeof el.tip === "string" && el.tip.trim() !== "" && el.tip.length <= 200
}

/** Hairline elements are nearly impossible to hover; a transparent 12px twin
 *  stroke inside the same wrapper widens the hit area without new geometry
 *  layers. Arcs/curves compile to figure-path, so they are covered by d. */
function twinStroke(el: SceneElement): string {
  const d =
    el.kind === "figure-path" || el.kind === "line-path" || el.kind === "arrow"
      ? el.d
      : el.kind === "figure-line"
        ? `M ${n2(el.x1)} ${n2(el.y1)} L ${n2(el.x2)} ${n2(el.y2)}`
        : null
  if (d === null) return ""
  return `<path class="exp-el-hit" d="${d}" stroke="transparent" stroke-width="12" fill="none" pointer-events="stroke"/>`
}

/** Wrap in the .exp-el group when the element carries identity. Duplicate ids
 *  resolve first-wins via `claimId` (silent salvage — the emit layer has no
 *  warning channel): a duplicate emits anonymous but keeps its tip. */
function wrapIdentity(el: SceneElement, inner: string, claimId: (id: string) => boolean): string {
  const idOk = hasIdentity(el) && claimId(el.id!)
  if (!idOk && !hasTip(el)) return inner
  const attrs =
    (idOk ? ` data-el-id="${escapeHtml(el.id!)}"` : "") +
    (hasTip(el) ? ` data-tip="${escapeHtml(el.tip!)}"` : "")
  const tabindex = hasTip(el) ? ` tabindex="0"` : ""
  return `<g class="exp-el"${attrs}${tabindex}>${inner}</g>`
}
```

Note: `escapeHtml` is already imported in `svg.ts`. If the escape test fails
because `escapeHtml` does not escape double quotes, extend it in
`src/core/inline.ts` to also map `"` → `&quot;` and re-run the full suite
(`tests/inline.test.ts` guards regressions there).

Rename the existing `cleanElement` to `cleanInner` (keep the switch exactly as-is) and add a new `cleanElement` that wraps:

```ts
function cleanElement(el: SceneElement, i: number, claimed: Set<string>): string {
  const identity = hasIdentity(el) || hasTip(el)
  return wrapIdentity(el, cleanInner(el, i) + (identity ? twinStroke(el) : ""), id => {
    if (claimed.has(id)) return false
    claimed.add(id)
    return true
  })
}
```

In `sceneToSvg`, replace the `const body = …` expression with (the svg template below it is unchanged):

```ts
  const claimed = new Set<string>() // first id wins; later duplicates emit anonymous
  const body = opts.sketch
    ? scene.elements
        .map((el, i) => {
          const roughPart = sketchElementSvg(el, opts.seed ?? "", i)
          const labelPart =
            el.kind === "node-box" ? nodeLabel(el) : el.kind === "label" ? label(el, i) : ""
          const identity = hasIdentity(el) || hasTip(el)
          return wrapIdentity(el, roughPart + labelPart + (identity ? twinStroke(el) : ""), id => {
            if (claimed.has(id)) return false
            claimed.add(id)
            return true
          })
        })
        .join("")
    : scene.elements.map((el, i) => cleanElement(el, i, claimed)).join("")
```

(`sketchElementSvg` itself needs no change — the wrapper is applied around its output, so attributes survive rough.js by construction. Only touch `sketch.ts` if the sketch test above fails.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/figures/svg.test.ts; echo "EXIT=$?"`
Expected: PASS — all existing tests too (the anonymous-element case is the byte-identical guard for the existing corpus).

Run: `npm test; echo "EXIT=$?"`
Expected: PASS — 206+ tests, no regressions anywhere.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck; echo "EXIT=$?"` — expected clean.

```bash
git add src/figures/scene.ts src/figures/svg.ts src/figures/sketch.ts tests/figures/svg.test.ts
git commit -m "$(cat <<'EOF'
feat(figures): element identity at SVG emit (data-el-id/data-tip)

Identified scene elements emit wrapped in a .exp-el group with tabindex
when a tip exists; hairline elements get a transparent twin stroke for
hit area. Anonymous elements render byte-identically to before.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 2: Derived identity — diagram arrows/nodes, chart points, timeline events

**Files:**
- Modify: `src/figures/layoutFlow.ts` (arrow id; node tip)
- Modify: `src/figures/layoutChart.ts` (point tip; bar/dot ids)
- Modify: `src/figures/layoutTimeline.ts` (event tip; dot id)
- Modify: `src/core/schema.ts` (node tip, event tip)
- Modify: `src/primitives/diagram.ts`, `src/primitives/chart.ts`, `src/primitives/timeline.ts` (pass the new fields through)
- Modify: `src/core/llm.ts` (prompt line for the three semantic surfaces)
- Test: `tests/diagram.test.ts`, `tests/chart.test.ts`, `tests/comparison-timeline.test.ts`

**Interfaces:**
- Consumes: Task 1 scene fields.
- Produces: `FlowNodeSpec` gains `tip?: string`; `ChartPoint` gains `tip?: string`; `TimelineEventSpec` gains `tip?: string`. Derived ids: arrow = `` `${from}->${to}` ``, chart bar = `` `bar:${label}` ``, chart dot = `` `dot:${label}` ``, timeline dot = `` `event:${index}` ``. Schema: `diagramNodeSchema.tip?` and the timeline event `tip?` are `z.string().min(1).max(200).optional()`.

- [ ] **Step 1: Write the failing tests**

In `tests/diagram.test.ts`, add one test inside the existing top-level `describe` (follow the file's render-and-assert style):

```ts
it("derives arrow ids and carries node tips into the scene", () => {
  const { html } = renderExplanation({
    version: 1,
    blocks: [
      {
        type: "diagram",
        nodes: [
          { id: "dep", label: "Deploy ships", tip: "Start of every incident" },
          { id: "lat", label: "Latency spikes" },
        ],
        edges: [{ from: "dep", to: "lat" }],
      },
    ],
  })
  expect(html).toContain(`data-el-id="dep"`)
  expect(html).toContain(`data-tip="Start of every incident"`)
  expect(html).toContain(`data-el-id="dep-&gt;lat"`) // derived arrow id, escaped >
})
```

In `tests/chart.test.ts`:

```ts
it("carries point tips and derives bar/dot ids", () => {
  const { html } = renderExplanation({
    version: 1,
    blocks: [
      {
        type: "chart",
        kind: "bar",
        points: [
          { label: "Mon", value: 120 },
          { label: "Wed", value: 240, tip: "Deploy day spike" },
        ],
      },
    ],
  })
  expect(html).toContain(`data-el-id="bar:Mon"`) // no tip → no tabindex, but id present
  expect(html).toContain(`data-tip="Deploy day spike"`)
})
```

(If the chart test file renders via `renderBlock("chart", …)`, mirror its existing call style; the assertion targets are the same strings.)

In `tests/comparison-timeline.test.ts`:

```ts
it("derives event ids and carries event tips in the figure form", () => {
  const { html } = renderExplanation({
    version: 1,
    blocks: [
      {
        type: "timeline",
        presentation: "figure",
        events: [
          { when: "Sep 12", what: "Onboarding ships", tip: "Steps cut from 7 to 3" },
          { when: "Sep 14", what: "Activations triple" },
        ],
      },
    ],
  })
  expect(html).toContain(`data-el-id="event:0"`)
  expect(html).toContain(`data-tip="Steps cut from 7 to 3"`)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/diagram.test.ts tests/chart.test.ts tests/comparison-timeline.test.ts; echo "EXIT=$?"`
Expected: FAIL — no `data-el-id` in output yet.

- [ ] **Step 3: Schema + spec plumbing**

`src/core/schema.ts` — `diagramNodeSchema` becomes:

```ts
export const diagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  shape: z.enum(["box", "round", "pill", "note"]).optional(),
  tip: z.string().min(1).max(200).optional(),
})
```

Timeline event object inside `timelineBlockSchema` gains the same line after `detail`:

```ts
        detail: z.string().min(1).optional(),
        tip: z.string().min(1).max(200).optional(),
```

Chart points stay `z.array(z.unknown())` — tips validate leniently in `parsePoints` (Step 5).

`src/figures/layoutFlow.ts` — `FlowNodeSpec` gains `tip?: string`. The arrow push in `layoutFlow` becomes:

```ts
    elements.push({
      kind: "arrow",
      d,
      head,
      edgeKind: e.kind ?? "leads",
      label: e.label,
      labelX,
      labelY,
      id: `${e.from}->${e.to}`,
    })
```

The node push becomes (add `tip: n.tip,` after `lines: p.lines,`):

```ts
    elements.push({
      kind: "node-box",
      id: p.id,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      shape: p.shape,
      label: p.label,
      lines: p.lines,
      tip: p.tip,
    })
```

and `Placed` gains `tip?: string`; the `placed.set` call passes `tip: n.tip`.

`src/figures/layoutChart.ts` — `ChartPoint` gains `tip?: string`. Bar case:

```ts
      elements.push({ kind: "bar", x, y, w: bw, h, valueLabel: fmtValue(p.value, spec.unit), id: `bar:${p.label}`, tip: p.tip })
```

Dot case:

```ts
      elements.push({ kind: "dot", x, y, id: `dot:${p.label}`, tip: p.tip })
```

`src/figures/layoutTimeline.ts` — `TimelineEventSpec` gains `tip?: string`; the event dot push becomes:

```ts
    elements.push({ kind: "dot", x, y: SPINE_Y, id: `event:${i}`, tip: e.tip })
```

- [ ] **Step 4: Primitives pass the fields through**

`src/primitives/diagram.ts` — spec mapping gains tip:

```ts
    nodes: block.nodes.map(n => ({ id: n.id, label: n.label, shape: n.shape, tip: n.tip })),
```

`src/primitives/timeline.ts` — figure-form mapping gains tip:

```ts
  const { scene } = layoutTimeline(block.events.map(e => ({ when: e.when, what: e.what, tip: e.tip })))
```

`src/primitives/chart.ts` — `parsePoints` reads tips leniently. Add inside the `forEach` after `points.push` is decided (replace the final `points.push({ label, value })`):

```ts
    let tip: string | undefined
    if (rec?.tip !== undefined) {
      if (typeof rec.tip === "string" && rec.tip.trim() !== "" && rec.tip.length <= 200) {
        tip = rec.tip
      } else {
        warnings.push(`figure-tip-too-long: chart point ${i} tip dropped — must be 1-200 characters`)
      }
    }
    points.push({ label, value, tip })
```

- [ ] **Step 5: Prompt line**

`src/core/llm.ts` — in the system prompt's diagram/chart/timeline bullets, append one sentence to the diagram bullet (after "Edge from/to must reference node ids."):

```
Nodes accept an optional tip (1-200 chars) shown on hover; chart points and timeline events accept the same optional tip.
```

- [ ] **Step 6: Run tests + typecheck, commit**

Run: `npx vitest run tests/diagram.test.ts tests/chart.test.ts tests/comparison-timeline.test.ts; echo "EXIT=$?"` — expected PASS.
Run: `npm test; echo "EXIT=$?"` and `npm run typecheck; echo "EXIT=$?"` — expected PASS/clean.

```bash
git add src/figures/layoutFlow.ts src/figures/layoutChart.ts src/figures/layoutTimeline.ts src/core/schema.ts src/primitives/diagram.ts src/primitives/chart.ts src/primitives/timeline.ts src/core/llm.ts tests/diagram.test.ts tests/chart.test.ts tests/comparison-timeline.test.ts
git commit -m "$(cat <<'EOF'
feat(figures): derived element ids + tips for diagram, chart, timeline

Arrows derive from->to ids, chart points bar:/dot: label ids, timeline
dots event:<index>; node/point/event tips flow through the schema and
layouts into the emit layer.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 3: Authored figure id/tip (parse + compile + prompt)

**Files:**
- Modify: `src/figures/authored.ts` (FigureEl leaves, parse helpers, compileEl pass-through, group warning)
- Modify: `src/core/llm.ts` (figure bullet gains id/tip sentence)
- Test: `tests/figures/authored.test.ts`

**Interfaces:**
- Consumes: Task 1 scene fields.
- Produces: authored leaf elements (`path`, `curve`, `arc`, `box`, `line`, `dot`, `label`) accept optional `id`/`tip`; `compileFigure` preserves them on the compiled scene elements. Warnings: `figure-id-invalid`, `figure-tip-too-long`, `figure-id-unsupported` (group identity).

- [ ] **Step 1: Write the failing tests**

Append to `tests/figures/authored.test.ts` (mirror the file's existing `compileFigure` usage style):

```ts
describe("authored element identity", () => {
  it("preserves id and tip on compiled leaf elements", () => {
    const { scene, warnings } = compileFigure({
      elements: [
        { kind: "dot", cx: 5, cy: 5, id: "pen", tip: "The pen dot" } as never,
        { kind: "line", x1: 0, y1: 0, x2: 5, y2: 5, id: "axis" } as never,
      ],
    })
    expect(warnings).toEqual([])
    expect(scene.elements[0]).toMatchObject({ id: "pen", tip: "The pen dot" })
    expect(scene.elements[1]).toMatchObject({ id: "axis" })
    expect(scene.elements[1].tip).toBeUndefined()
  })

  it("drops an invalid id with figure-id-invalid", () => {
    const { scene, warnings } = compileFigure({
      elements: [{ kind: "dot", cx: 5, cy: 5, id: "not a name!" } as never],
    })
    expect(warnings.some(w => w.startsWith("figure-id-invalid"))).toBe(true)
    expect(scene.elements[0]!.id).toBeUndefined()
  })

  it("drops an over-long tip with figure-tip-too-long", () => {
    const { scene, warnings } = compileFigure({
      elements: [{ kind: "dot", cx: 5, cy: 5, tip: "x".repeat(201) } as never],
    })
    expect(warnings.some(w => w.startsWith("figure-tip-too-long"))).toBe(true)
    expect(scene.elements[0]!.tip).toBeUndefined()
  })

  it("warns figure-id-unsupported and drops group identity, keeps child identity", () => {
    const { scene, warnings } = compileFigure({
      elements: [
        {
          kind: "group",
          dx: 10,
          id: "g1",
          tip: "group tip",
          elements: [{ kind: "dot", cx: 0, cy: 0, id: "kid" } as never],
        } as never,
      ],
    })
    expect(warnings.some(w => w.startsWith("figure-id-unsupported"))).toBe(true)
    const dot = scene.elements[0]! as { id?: string }
    expect(dot.id).toBe("kid")
  })
})
```

(The `as never` casts satisfy the union until Task code widens it; remove the casts in Step 3 if tsc no longer needs them — run `npm run typecheck` to decide. Keep the test file cast-free if possible.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/figures/authored.test.ts; echo "EXIT=$?"`
Expected: FAIL — TypeScript excess-property errors surface as vitest transform failures, or `id` is undefined.

- [ ] **Step 3: Implement in `authored.ts`**

Add the two leaf fields to the `FigureEl` union — every leaf variant gains `id?: string; tip?: string` (shown here as the full new union, comments stripped to the changed lines):

```ts
export type FigureEl =
  | { kind: "path"; d: string; tone?: Tone; fill?: Tone; width?: Num; id?: string; tip?: string }
  | { kind: "curve"; from: XY; cp1: XY; cp2: XY; to: XY; tone?: Tone; width?: Num; id?: string; tip?: string }
  | { kind: "arc"; cx: Num; cy: Num; rx: Num; ry: Num; start: Num; end: Num; tone?: Tone; width?: Num; id?: string; tip?: string }
  | { kind: "box"; x: Num; y: Num; w: Num; h: Num; r?: Num; label?: string; tone?: Tone; fill?: Tone; id?: string; tip?: string }
  | { kind: "line"; x1: Num; y1: Num; x2: Num; y2: Num; tone?: Tone; width?: Num; id?: string; tip?: string }
  | { kind: "dot"; cx: Num; cy: Num; r?: Num; tone?: Tone; id?: string; tip?: string }
  | { kind: "label"; x: Num; y: Num; text: string; size?: Num; anchor?: "start" | "middle" | "end"; id?: string; tip?: string }
  | { kind: "group"; dx?: Num; dy?: Num; elements: FigureEl[] } // identity deliberately absent (v1)
```

Add near `parseTone`:

```ts
const EL_ID_RE = /^[\w][\w-]*$/

/** Lenient identity parse: invalid input drops the FIELD (not the element)
 *  with a warning; the element still renders, just anonymous. */
function parseId(v: unknown, warn: (m: string) => void): string | undefined {
  if (v === undefined) return undefined
  if (typeof v === "string" && v.length <= 100 && EL_ID_RE.test(v)) return v
  warn("figure-id-invalid: element id must match /^[\\w][\\w-]*$/ (max 100 chars)")
  return undefined
}

function parseTip(v: unknown, warn: (m: string) => void): string | undefined {
  if (v === undefined) return undefined
  if (typeof v !== "string" || v.trim() === "") return undefined
  if (v.length > 200) {
    warn("figure-tip-too-long: tip must be at most 200 characters")
    return undefined
  }
  return v
}
```

In `parseFigureElement`, each leaf case gains `id: parseId(raw.id, warn), tip: parseTip(raw.tip, warn)` in its returned object — e.g. the `path` case returns:

```ts
      return {
        kind: "path",
        d: raw.d,
        tone: parseTone(raw.tone),
        fill: parseTone(raw.fill),
        width: parseNum(raw.width),
        id: parseId(raw.id, warn),
        tip: parseTip(raw.tip, warn),
      }
```

Apply the same two lines to the `curve`, `arc`, `box`, `line`, `dot`, and `label` return objects. The `group` case gains a rejection at its top (before parsing children):

```ts
      if (raw.id !== undefined || raw.tip !== undefined) {
        warn("figure-id-unsupported: groups do not carry identity in v1")
      }
```

In `compileEl`, each leaf case's `out` object gains `id: el.id, tip: el.tip` — e.g. the `dot` case:

```ts
      const out: FigureDotEl = { kind: "figure-dot", cx: dx + cx!, cy: dy + cy!, r: r === null ? 3 : r!, tone: el.tone ?? "accent", id: el.id, tip: el.tip }
```

Apply the same pair to the `path` (`FigurePathEl`), `curve`/`arc` (`FigurePathEl`), `box` (`FigureBoxEl`), `line` (`FigureLineEl`), and `label` (`FigureLabelEl`) cases. Groups need no compile change — children already carry identity through `flatten`.

`src/core/llm.ts` — in the figure bullet, after "tones are `\"ink\"|\"muted\"|\"accent\"`", insert:

```
Leaf elements accept optional id (identifier, ≤100 chars) and tip (≤200 chars, shown on hover); give ids/tips only to elements worth explaining.
```

- [ ] **Step 4: Run tests + typecheck, commit**

Run: `npx vitest run tests/figures/authored.test.ts; echo "EXIT=$?"` — PASS.
Run: `npm test; echo "EXIT=$?"` and `npm run typecheck; echo "EXIT=$?"` — PASS/clean (remove the now-unneeded `as never` casts if tsc is happy without them).

```bash
git add src/figures/authored.ts src/core/llm.ts tests/figures/authored.test.ts
git commit -m "$(cat <<'EOF'
feat(figures): authored element id/tip with lenient validation

Leaf authored elements accept id/tip; invalid ids and over-long tips
drop the field with a warning, groups reject identity outright, and
compiled scenes preserve identity for the emit layer.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 4: Pure React hit logic + popover placement (`figureEvents.ts`)

**Files:**
- Create: `src/react/figureEvents.ts`
- Test: `tests/react.test.tsx` (new describe blocks; file stays SSR-only — no DOM env needed)

**Interfaces:**
- Consumes: Task 1 emit format (`exp-el` class, `data-el-id`, `data-tip`).
- Produces (Task 5 consumes exactly):
  - `type FigureElementEvent = { kind: "hover"; elId: string; phase: "start" | "end" } | { kind: "click"; elId: string }`
  - `interface ElementHit { elId: string; tip: string | null; node: Element }`
  - `hitElement(target: EventTarget | null): ElementHit | null`
  - `resolveTip(text: string | null): string | null`
  - `interface Placement { top: number; left: number; placement: "above" | "below" }`
  - `placePopover(anchor: { left: number; top: number; width: number; height: number; right: number; bottom: number }, stage: { left: number; top: number; right: number }): Placement`

- [ ] **Step 1: Write the failing tests**

Append to `tests/react.test.tsx`:

```tsx
import { hitElement, placePopover, resolveTip } from "../src/react/figureEvents"

describe("resolveTip", () => {
  it("keeps non-empty tips within the cap", () => {
    expect(resolveTip("hello")).toBe("hello")
    expect(resolveTip("  spaced  ")).toBe("spaced")
    expect(resolveTip("x".repeat(200))).toBe("x".repeat(200))
  })
  it("nulls empty and over-long tips", () => {
    expect(resolveTip(null)).toBe(null)
    expect(resolveTip("")).toBe(null)
    expect(resolveTip("   ")).toBe(null)
    expect(resolveTip("x".repeat(201))).toBe(null)
  })
})

describe("hitElement", () => {
  const makeEl = (attrs: Record<string, string>, parent?: Element): Element => {
    const el = {
      getAttribute: (k: string) => attrs[k] ?? null,
      closest: (sel: string) => (sel === ".exp-el" ? el : null),
    } as unknown as Element
    return el
  }

  it("reads elId and tip off the hit element", () => {
    const node = makeEl({ "data-el-id": "pen", "data-tip": "The pen" })
    expect(hitElement(node)).toEqual({ elId: "pen", tip: "The pen", node })
  })

  it("returns null for chrome without identity", () => {
    const node = makeEl({})
    expect(hitElement(node)).toBe(null)
    expect(hitElement(null)).toBe(null)
  })
})

describe("placePopover", () => {
  const stage = { left: 0, top: 0, right: 400 }
  it("prefers above with a gap when there is headroom", () => {
    const anchor = { left: 100, top: 80, width: 20, height: 20, right: 120, bottom: 100 }
    const p = placePopover(anchor, stage)
    expect(p.placement).toBe("above")
    expect(p.top).toBe(72) // anchor.top - GAP(8)
  })
  it("flips below when clipped at the top", () => {
    const anchor = { left: 100, top: 10, width: 20, height: 20, right: 120, bottom: 30 }
    const p = placePopover(anchor, stage)
    expect(p.placement).toBe("below")
    expect(p.top).toBe(38) // anchor.bottom + GAP(8)
  })
  it("nudges horizontally to stay inside the stage", () => {
    const anchor = { left: 380, top: 80, width: 20, height: 20, right: 400, bottom: 100 }
    const p = placePopover(anchor, stage)
    expect(p.left).toBe(136) // stage.right - MAX_W(260) - 4
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/react.test.tsx; echo "EXIT=$?"`
Expected: FAIL — module `../src/react/figureEvents` does not exist.

- [ ] **Step 3: Implement `src/react/figureEvents.ts`**

```ts
/** Pure hit-test + popover placement logic for the interactivity layer
 *  (spec §5). No React imports — the components in ElementPopover.tsx and
 *  the wiring tasks consume these; everything here is unit-testable. */

export type FigureElementEvent =
  | { kind: "hover"; elId: string; phase: "start" | "end" }
  | { kind: "click"; elId: string }

export interface ElementHit {
  elId: string
  tip: string | null
  node: Element
}

const MAX_TIP = 200

/** Tips sanitize to null: empty/whitespace and over-long never render. */
export function resolveTip(text: string | null): string | null {
  if (!text) return null
  const t = text.trim()
  return t !== "" && t.length <= MAX_TIP ? t : null
}

/** Walk from the event target up to the identified wrapper emitted by
 *  sceneToSvg (`<g class="exp-el" data-el-id=…>`). Chrome returns null. */
export function hitElement(target: EventTarget | null): ElementHit | null {
  if (!target || typeof (target as Element).closest !== "function") return null
  const el = (target as Element).closest<HTMLElement>(".exp-el")
  if (!el) return null
  const elId = el.getAttribute("data-el-id")
  if (!elId) return null
  return { elId, tip: resolveTip(el.getAttribute("data-tip")), node: el }
}

export interface Placement {
  top: number
  left: number
  placement: "above" | "below"
}

const GAP = 8
const MAX_W = 260
const HEADROOM = 60 // rough popover height allowance for the above/below flip

/** Position a max-width popover relative to the stage box. Prefer above the
 *  anchor (bottom edge sits GAP above it — the component adds translateY(-100%)),
 *  flip below when clipped, nudge horizontally inside the stage. */
export function placePopover(
  anchor: { left: number; top: number; width: number; height: number; right: number; bottom: number },
  stage: { left: number; top: number; right: number },
): Placement {
  let left = anchor.left + anchor.width / 2 - MAX_W / 2
  left = Math.min(Math.max(left, stage.left + 4), stage.right - MAX_W - 4)
  const above = anchor.top - stage.top >= HEADROOM
  const top = above ? anchor.top - stage.top - GAP : anchor.bottom - stage.top + GAP
  return { top, left: left - stage.left, placement: above ? "above" : "below" }
}
```

- [ ] **Step 4: Run tests + typecheck, commit**

Run: `npx vitest run tests/react.test.tsx; echo "EXIT=$?"` — PASS.
Run: `npm run typecheck; echo "EXIT=$?"` — clean.

```bash
git add src/react/figureEvents.ts tests/react.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): pure element-hit logic and popover placement

hitElement walks to the emitted .exp-el wrapper, resolveTip sanitizes
tips, placePopover computes above/below placement over two rects —
all framework-pure and unit-tested without a DOM.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 5: Popover component + delegated wiring (InteractiveFigure, Explanation) + CSS

**Files:**
- Create: `src/react/ElementPopover.tsx` (hook + popover div + static wrapper)
- Modify: `src/react/InteractiveFigure.tsx` (stage uses the hook; new `onElementEvent` prop)
- Modify: `src/react/Explanation.tsx` (new `onElementEvent` prop routes figure/diagram/chart blocks through the static wrapper)
- Modify: `src/react/index.ts` (export the new public surface)
- Modify: `src/themes/tokens.css` (append via bash heredoc)
- Test: `tests/react.test.tsx`

**Interfaces:**
- Consumes: Task 4 exports, `renderInline` from `../core/inline`, existing `exp-fig-stage` class.
- Produces:
  - `useElementPopover(onEvent?: (e: FigureElementEvent) => void): { stageRef: RefObject<HTMLDivElement | null>; pop: PopoverState | null; bind: BindHandlers }`
  - `PopoverState = { elId: string; tip: string; top: number; left: number; placement: "above" | "below" }`
  - `PopoverDiv: FC<{ pop: PopoverState }>` (renders `role="tooltip"` div, tip through `renderInline`)
  - `FigureEvents: FC<{ html: string; onEvent?: (e: FigureElementEvent) => void }>` (client wrapper for the static path)
  - `ExplanationProps.onElementEvent?: (e: FigureElementEvent) => void`; `InteractiveFigureProps.onElementEvent?` same.

- [ ] **Step 1: Write the failing tests**

Append to `tests/react.test.tsx` (SSR-only assertions — interaction is verified by browser eyes on the demo in Task 6):

```tsx
import { Explanation } from "../src/react/Explanation" // already imported

const tippedFigure = {
  type: "figure",
  title: "Orbit",
  elements: [
    { kind: "dot", cx: 100, cy: 80, r: 6, id: "pen", tip: "The pen dot" },
    { kind: "dot", cx: 10, cy: 10, r: 3 },
  ],
}

describe("element popover wiring (SSR)", () => {
  it("renders tip-bearing elements focusable and the popover closed", () => {
    const html = renderToStaticMarkup(<InteractiveFigure block={tippedFigure} />)
    expect(html).toContain(`tabindex="0"`)
    expect(html).toContain(`data-tip="The pen dot"`)
    expect(html).not.toContain(`exp-popover`) // closed initially — SSR-safe
  })

  it("static path wraps figure blocks in the delegated container when onElementEvent is set", () => {
    const withHandler = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [tippedFigure] }} theme="none" onElementEvent={() => {}} />,
    )
    expect(withHandler).toContain(`exp-fig-events`)
    expect(withHandler).toContain(`data-el-id="pen"`)
    const without = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [tippedFigure] }} theme="none" />,
    )
    expect(without).not.toContain(`exp-fig-events`) // RSC-safe default
  })

  it("static wrapper also covers diagram and chart blocks", () => {
    const html = renderToStaticMarkup(
      <Explanation
        ir={{
          version: 1,
          blocks: [
            {
              type: "diagram",
              nodes: [{ id: "a", label: "A", tip: "Node A" }],
              edges: [],
            },
          ],
        }}
        theme="none"
        onElementEvent={() => {}}
      />,
    )
    expect(html).toContain(`exp-fig-events`)
    expect(html).toContain(`data-tip="Node A"`)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/react.test.tsx; echo "EXIT=$?"`
Expected: FAIL — `onElementEvent` prop unknown / `exp-fig-events` never rendered.

- [ ] **Step 3: Create `src/react/ElementPopover.tsx`**

```tsx
"use client"
import { useCallback, useEffect, useRef, useState, type FC, type RefObject } from "react"
import { hitElement, placePopover, type FigureElementEvent } from "./figureEvents"
import { renderInline } from "../core/inline"

export interface PopoverState {
  elId: string
  tip: string
  top: number
  left: number
  placement: "above" | "below"
}

interface BindHandlers {
  onPointerOver: (e: React.PointerEvent) => void
  onPointerOut: (e: React.PointerEvent) => void
  onClick: (e: React.MouseEvent) => void
  onFocusCapture: (e: React.FocusEvent) => void
  onBlurCapture: () => void
}

/** One delegated listener set per figure stage. Popover state is client-only
 *  and starts closed, so SSR markup is identical to the static render (spec §5).
 *  v1: no repositioning on scroll/sweep — pointerout closes the popover. */
export function useElementPopover(onEvent?: (e: FigureElementEvent) => void): {
  stageRef: RefObject<HTMLDivElement | null>
  pop: PopoverState | null
  bind: BindHandlers
} {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [pop, setPop] = useState<PopoverState | null>(null)

  const show = useCallback((target: EventTarget | null) => {
    const hit = hitElement(target)
    const stage = stageRef.current
    if (!hit || !hit.tip || !stage) return
    const p = placePopover(hit.node.getBoundingClientRect(), stage.getBoundingClientRect())
    setPop({ elId: hit.elId, tip: hit.tip, top: p.top, left: p.left, placement: p.placement })
  }, [])

  const onPointerOver = useCallback(
    (e: React.PointerEvent) => {
      const hit = hitElement(e.target)
      if (!hit) return
      onEvent?.({ kind: "hover", elId: hit.elId, phase: "start" })
      show(e.target)
    },
    [onEvent, show],
  )

  const onPointerOut = useCallback(
    (e: React.PointerEvent) => {
      const hit = hitElement(e.target)
      if (hit) onEvent?.({ kind: "hover", elId: hit.elId, phase: "end" })
      setPop(null)
    },
    [onEvent],
  )

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitElement(e.target)
      if (!hit) {
        setPop(null)
        return
      }
      onEvent?.({ kind: "click", elId: hit.elId })
      show(e.target)
    },
    [onEvent, show],
  )

  const onFocusCapture = useCallback((e: React.FocusEvent) => show(e.target), [show])
  const onBlurCapture = useCallback(() => setPop(null), [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPop(null)
    }
    stage.addEventListener("keydown", onKey)
    return () => stage.removeEventListener("keydown", onKey)
  }, [])

  return {
    stageRef,
    pop,
    bind: { onPointerOver, onPointerOut, onClick, onFocusCapture, onBlurCapture },
  }
}

export const PopoverDiv: FC<{ pop: PopoverState }> = ({ pop }) => (
  <div
    className={`exp-popover exp-popover-${pop.placement}`}
    role="tooltip"
    style={{ top: pop.top, left: pop.left }}
    dangerouslySetInnerHTML={{ __html: renderInline(pop.tip) }}
  />
)

/** Static-path wrapper: same delegation around a rendered block's HTML.
 *  Only mounted when the host passed onElementEvent (opt-in, keeps
 *  <Explanation> RSC-safe by default). */
export const FigureEvents: FC<{ html: string; onEvent?: (e: FigureElementEvent) => void }> = ({
  html,
  onEvent,
}) => {
  const { stageRef, pop, bind } = useElementPopover(onEvent)
  return (
    <div ref={stageRef} className="exp-fig-events" {...bind}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {pop && <PopoverDiv pop={pop} />}
    </div>
  )
}
```

- [ ] **Step 4: Wire `InteractiveFigure`**

`src/react/InteractiveFigure.tsx`:

- Import: `import { PopoverDiv, useElementPopover } from "./ElementPopover"` and `import type { FigureElementEvent } from "./figureEvents"`.
- `InteractiveFigureProps` gains:

```ts
  /** Delegate hover/click events for identified elements (spec §5). */
  onElementEvent?: (e: FigureElementEvent) => void
```

- Destructure it in the component and add above `body`:

```ts
  const { stageRef, pop, bind } = useElementPopover(onElementEvent)
```

- Replace the `body` expression with:

```tsx
  const body = svg ? (
    <div className="exp-fig-stage" ref={stageRef} {...bind}>
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      {pop && <PopoverDiv pop={pop} />}
    </div>
  ) : (
    <p className="exp-fig-empty">Figure could not be drawn.</p>
  )
```

(The previous markup injected `svg` directly into the stage div; the new inner div keeps `exp-fig-stage` as the positioning context so `exp-popover` absolute coordinates resolve against it.)

- [ ] **Step 5: Wire `Explanation` + exports**

`src/react/Explanation.tsx`:

- Imports: `import { FigureEvents } from "./ElementPopover"` and `import type { FigureElementEvent } from "./figureEvents"`.
- `ExplanationProps` gains:

```ts
  /** Delegate hover/click events for identified figure elements. Presence
   *  routes figure/diagram/chart blocks through a small client wrapper;
   *  default undefined keeps this component RSC-safe. */
  onElementEvent?: (e: FigureElementEvent) => void
```

- Destructure `onElementEvent` and, inside the blocks map just before the final `return <div key={b.index} …>` fallback, add:

```tsx
        if (onElementEvent && b.kind === "valid" && (b.type === "figure" || b.type === "diagram" || b.type === "chart")) {
          const html = renderBlock(b.type, b.data, 1, { sketch })
          return <FigureEvents key={b.index} html={html} onEvent={onElementEvent} />
        }
```

(Timeline stays on the plain static path in v1 — its figure form is decided inside `renderBlock`; popover coverage for it arrives with the interactive runtime if wanted.)

`src/react/index.ts` — add:

```ts
export { FigureEvents, PopoverDiv, useElementPopover } from "./ElementPopover"
export type { FigureElementEvent } from "./figureEvents"
```

(Match the file's existing export style — `export { … } from …` lines at the bottom.)

- [ ] **Step 6: Append CSS via bash heredoc**

```bash
cat >> src/themes/tokens.css <<'EOF'

/* Element interactivity (spec 2026-09-29-figure-interactivity-events).
   Popover tokens default to a dark surface that works on both themes. */
.exp {
  --exp-popover-bg: #1a1d23;
  --exp-popover-fg: #ffffff;
  --exp-popover-border: transparent;
  --exp-popover-shadow: 0 4px 12px rgb(0 0 0 / 0.25);
}

.exp-fig-stage,
.exp-fig-events {
  position: relative;
}

.exp-el-hit {
  pointer-events: stroke;
}

.exp-el[data-tip]:hover,
.exp-el[data-tip]:focus-visible {
  opacity: 0.8;
}

.exp-el:focus {
  outline: none;
}

.exp-el[data-tip]:focus-visible {
  outline: 2px solid var(--exp-accent);
  outline-offset: 2px;
}

.exp-popover {
  position: absolute;
  z-index: 10;
  max-width: 260px;
  background: var(--exp-popover-bg);
  color: var(--exp-popover-fg);
  border: 1px solid var(--exp-popover-border);
  box-shadow: var(--exp-popover-shadow);
  border-radius: var(--exp-radius-sm);
  padding: 6px 10px;
  font-size: 0.85em;
  pointer-events: none;
}

.exp-popover p {
  margin: 0;
}

.exp-popover-above {
  transform: translateY(-100%);
}

.exp-popover-below {
  transform: none;
}
EOF
```

- [ ] **Step 7: Run tests + typecheck, commit**

Run: `npx vitest run tests/react.test.tsx; echo "EXIT=$?"` — PASS (all existing tests too — the markup-parity tests assert `contains`, and the new inner stage div does not break them).
Run: `npm test; echo "EXIT=$?"`, `npm run typecheck; echo "EXIT=$?"`, `npm run build; echo "EXIT=$?"` — all green (build confirms the react entry still bundles with the new client component).

```bash
git add src/react/ElementPopover.tsx src/react/InteractiveFigure.tsx src/react/Explanation.tsx src/react/index.ts src/themes/tokens.css tests/react.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): delegated element events + popover primitive

One listener set per figure stage (hook + static wrapper), IR-driven
tooltip popover with escape/focus support, opt-in onElementEvent on
Explanation and InteractiveFigure. RSC-safe when absent.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 6: Demo, docs, full verification

**Files:**
- Modify: `demo/examples.js` (tips on the figuresIr diagram, chart, and epicycles dot)
- Modify: `tests/demo-examples.test.ts` (tips present in rendered output)
- Modify: `docs/ROADMAP.md` (backlog → Shipped)
- Modify: `.superpowers/sdd/progress.md` (ledger, appended at the very end of the task)

**Interfaces:**
- Consumes: everything above.
- Produces: demo page exercising diagram/chart/authored tips; roadmap and ledger updated.

- [ ] **Step 1: Add tips to the demo fixtures**

`demo/examples.js` — in `figuresIr`:

- Diagram nodes: `dep` gains `tip: "Every incident review starts here"`, `lat` gains `tip: "p95 — the number the SLO watches"`, `rb` gains `tip: "Automated canary revert"`.
- Chart points: `Wed` (value 240) gains `tip: "Deploy day — 2× the weekly median"`.
- Epicycles: the last inner `dot` (r: 3, the pen) gains `id: "pen"` and `tip: "Sum of the three circular motions — traced right as the square wave"`. The first inner dot (r: 2) gains `id: "epi-1"`, the second `id: "epi-2"` (no tips — ids only).

- [ ] **Step 2: Write the failing demo test**

In `tests/demo-examples.test.ts`, add:

```ts
it("demo fixtures carry element tips that survive rendering", () => {
  const { html } = renderExplanation(figuresIr)
  expect(html).toContain(`data-tip="Every incident review starts here"`)
  expect(html).toContain(`data-el-id="bar:Wed"`)
  expect(html).toContain(`data-tip="Deploy day — 2× the weekly median"`)
  expect(html).toContain(`data-el-id="pen"`)
  expect(html).toContain(`data-tip="Sum of the three circular motions — traced right as the square wave"`)
})
```

(Match the file's existing import of `figuresIr`/`renderExplanation`; if it imports differently, follow its style.)

- [ ] **Step 3: Run tests to verify they fail, then flip fixtures in if needed**

Run: `npx vitest run tests/demo-examples.test.ts; echo "EXIT=$?"`
Expected: after Step 1 the test PASSES; if you wrote the test first without Step 1, it fails — then apply Step 1 and re-run.

- [ ] **Step 4: Roadmap flip**

`docs/ROADMAP.md` — remove the events bullet from Backlog and add to Shipped (after the interactive runtime entry):

```markdown
- **Figure interactivity events** (2026-09-29) — element `id`/`tip` through
  Scene IR (authored leaves, diagram nodes, chart points, timeline events;
  arrows/points/events derive ids), `data-el-id`/`data-tip` at SVG emit with
  twin-stroke hit areas, delegated React events (`onElementEvent`) and a
  built-in popover. Spec:
  `docs/superpowers/specs/2026-09-29-figure-interactivity-events-design.md`.
```

- [ ] **Step 5: Full verification**

Run each, expect green:
- `npm test; echo "EXIT=$?"`
- `npm run typecheck; echo "EXIT=$?"`
- `npm run build; echo "EXIT=$?"`

Browser eyes (established incantation):

```bash
lsof -ti :4173 | xargs kill 2>/dev/null; sleep 1; nohup perl -e 'use POSIX; setsid(); exec("node", "demo/server.mjs") or die' > /tmp/demo-server.log 2>&1 &
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/
```

Then verify in the browser at `http://localhost:4173/`: hover a diagram node (popover above), hover the Wed bar (flip/positioning), hover the epicycles pen dot while playing (v1: popover closes only on pointerout — accepted simplification), Escape closes, Tab focuses tip-bearing elements. Static `/` page has no JS — hover affordance is CSS-only.

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:

```
Figure-events Task 1: complete (emit layer + scene identity)
Figure-events Task 2: complete (derived ids/tips: diagram, chart, timeline)
Figure-events Task 3: complete (authored id/tip)
Figure-events Task 4: complete (hit logic + placement, pure)
Figure-events Task 5: complete (popover + delegation + CSS)
Figure-events Task 6: complete (demo, roadmap, verification <N>/<N> tests)
```

```bash
git add demo/examples.js tests/demo-examples.test.ts docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
demo: exercise element tips across diagram, chart, and epicycles

Roadmap flips figure interactivity events to shipped.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

(Ledger is intentionally left uncommitted with the working tree, matching prior cycles.)
