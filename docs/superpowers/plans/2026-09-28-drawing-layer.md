# Drawing Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let explanations *draw* — LLM-emitted `diagram` and `chart` blocks plus figure forms of `cause-effect`/`timeline`/`data-callout`, rendered as themed SVG with an optional rough.js sketch pass.

**Architecture:** One shared figure subsystem (`src/figures/`): layouts compile semantic specs INTO a `Scene`; one serializer compiles a Scene OUT to SVG using only `var(--exp-*)` tokens. New primitives and presentation upgrades are thin adapters over it. Sketch mode is an opt-in render option; progressive draw is CSS-only.

**Tech Stack:** TypeScript (ESM), zod ^4, roughjs (new runtime dependency), vitest. No DOM APIs anywhere in `src/core` or `src/figures` (SSR-safe).

**Spec:** `docs/superpowers/specs/2026-09-28-drawing-layer-design.md`

## Global Constraints

- The IR contains **no coordinates**. Layouts compute all geometry. (spec §Decisions)
- Only two runtime dependencies: `zod` ^4 (existing) and `roughjs` (added in Task 6). No others.
- Every color/stroke in figure SVG references CSS custom properties (`var(--exp-ink)`, `var(--exp-accent)`, …) — never literal colors in `src/figures/` output. (spec §2)
- Determinism: same IR → byte-identical SVG. No `Date.now()`, `Math.random()`, or iteration-order dependence. Sketch seed = block `id`, else content hash. (spec §2)
- Leniency: per-part salvage with warnings (`ctx.addWarning`), never throw unless `strict`. (spec §1, §3)
- All IR strings are HTML-escaped via `escapeHtml` from `src/core/inline.ts` — including inside SVG `<text>` and attributes; prose fields use `renderInline`. (spec §3)
- Zero DOM usage in figures: roughjs is used via `rough.generator()` + `generator.toPaths(drawable)` (pure math, SSR-safe), never `rough.svg(...)`.
- Existing text renderings of `cause-effect`, `timeline`, `data-callout` remain byte-identical when `presentation: "text"` (or when the figure form doesn't fit). (spec §3)
- New schemas/types live in `src/core/schema.ts` and are exported from the package root automatically via `export * from "./core/schema"` — `src/index.ts` needs no edits. (spec §3)
- `tests/themes.test.ts` extracts every `exp-*` class from rendered HTML and requires it to exist in `src/themes/*.css` — any new emitted class must have a CSS rule (Task 2 lands all of them before any primitive task).

## Spec amendments recorded here (not in the spec doc)

1. `data-callout` gains an optional `series?: number[]` (2–24 samples) — the spec's "trend sparkline" needs numeric data the IR didn't have. Added in Task 5.
2. Sketch mode threads through `RenderContext.sketch` (Task 6) so primitives pass it to the serializer; `renderBlock()` gains an optional `{ sketch }` arg for the React adapter.

---

### Task 1: Scene model + SVG serializer (clean strokes)

**Files:**
- Create: `src/figures/scene.ts`
- Create: `src/figures/svg.ts`
- Test: `tests/figures/svg.test.ts`

**Interfaces:**
- Consumes: `escapeHtml` from `src/core/inline.ts`.
- Produces: `Scene`, `SceneElement` (union of 8 element kinds) from `scene.ts`; `sceneToSvg(scene: Scene, opts: SceneSvgOptions): string` and `n2(n: number): string` from `svg.ts`. All later tasks build Scenes and call `sceneToSvg`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/figures/svg.test.ts
import { describe, expect, it } from "vitest"
import { sceneToSvg } from "../../src/figures/svg"
import type { Scene } from "../../src/figures/scene"

const scene: Scene = {
  width: 240,
  height: 76,
  elements: [
    { kind: "node-box", id: "a", x: 16, y: 16, w: 90, h: 44, shape: "box", label: "Start" },
    {
      kind: "arrow",
      d: "M106 38 C 133 38, 133 38, 160 38",
      head: "M160 38 L151 33.5 L151 42.5 Z",
      label: "then",
      labelX: 133,
      labelY: 32,
      edgeKind: "causes",
    },
    { kind: "node-box", id: "b", x: 160, y: 16, w: 64, h: 44, shape: "round", label: "End" },
  ],
}

describe("sceneToSvg", () => {
  it("emits an accessible, token-based svg", () => {
    const svg = sceneToSvg(scene, { ariaLabel: "Start → End" })
    expect(svg).toMatch(/^<svg class="exp-figure" viewBox="0 0 240 76" role="img" aria-label="Start → End"/)
    expect(svg).toContain(`<title>Start → End</title>`)
    expect(svg).toContain(`fill="var(--exp-node-fill)"`)
    expect(svg).toContain(`stroke="var(--exp-node-stroke)"`)
    expect(svg).toContain(`class="exp-arrow"`)
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}/i) // no literal colors
  })

  it("escapes IR text inside labels, titles, and aria", () => {
    const s: Scene = {
      width: 100,
      height: 40,
      elements: [{ kind: "label", x: 4, y: 20, text: "<b>&x</b>", anchor: "start" }],
    }
    const svg = sceneToSvg(s, { ariaLabel: "<script>alert(1)</script>" })
    expect(svg).toContain("&lt;b&gt;&amp;x&lt;/b&gt;")
    expect(svg).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>")
    expect(svg).not.toContain("<script>")
  })

  it("stamps a per-element --draw-i style for later draw-in animation", () => {
    const svg = sceneToSvg(scene, { ariaLabel: "x" })
    expect(svg).toContain(`style="--draw-i:0"`)
    expect(svg).toContain(`style="--draw-i:1"`)
  })

  it("is deterministic", () => {
    expect(sceneToSvg(scene, { ariaLabel: "x" })).toBe(sceneToSvg(scene, { ariaLabel: "x" }))
  })

  it("renders each element kind with its class", () => {
    const s: Scene = {
      width: 200,
      height: 120,
      elements: [
        { kind: "axis", x1: 10, y1: 100, x2: 190, y2: 100 },
        { kind: "bar", x: 20, y: 40, w: 30, h: 60, valueLabel: "3ms" },
        { kind: "line-path", d: "M20 80 L60 50" },
        { kind: "dot", x: 60, y: 50 },
        { kind: "sparkline", d: "M0 24 L40 12 L80 4", trend: "up" },
        { kind: "node-box", id: "n", x: 120, y: 20, w: 70, h: 30, shape: "pill", label: "P" },
        { kind: "label", x: 20, y: 20, text: "L", anchor: "middle", emphasis: true },
      ],
    }
    const svg = sceneToSvg(s, { ariaLabel: "kinds" })
    expect(svg).toContain(`class="exp-axis"`)
    expect(svg).toContain(`class="exp-bar"`)
    expect(svg).toContain(`class="exp-line-path"`)
    expect(svg).toContain(`class="exp-dot"`)
    expect(svg).toContain(`class="exp-sparkline exp-sparkline-up"`)
    expect(svg).toContain(`class="exp-node exp-node-pill"`)
    expect(svg).toContain(`class="exp-fig-label exp-fig-label-emphasis"`)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/figures/svg.test.ts`
Expected: FAIL — cannot find module `../../src/figures/svg`

- [ ] **Step 3: Write `src/figures/scene.ts`**

```ts
/** Scene model — the internal currency of the figure system.
 *  Layouts compile semantic specs INTO a Scene; sceneToSvg compiles a Scene OUT to SVG.
 *  No coordinates ever enter or leave the IR — Scene is internal to src/figures. */

export type NodeShape = "box" | "round" | "pill" | "note"

export interface NodeBoxEl {
  kind: "node-box"
  id: string
  x: number
  y: number
  w: number
  h: number
  shape: NodeShape
  label: string
}

export type EdgeKind = "causes" | "leads" | "part-of" | "conflict"

export interface ArrowEl {
  kind: "arrow"
  /** Shaft path; ends just short of the head tip. */
  d: string
  /** Closed triangle path for the arrowhead. */
  head: string
  label?: string
  /** Label anchor point (computed by the layout, absolute scene coordinates). */
  labelX?: number
  labelY?: number
  edgeKind: EdgeKind
}

export interface LabelEl {
  kind: "label"
  x: number
  y: number
  text: string
  anchor: "start" | "middle" | "end"
  /** Emphasis labels are ink-colored and bold; default labels are muted. */
  emphasis?: boolean
}

export interface AxisEl {
  kind: "axis"
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface BarEl {
  kind: "bar"
  x: number
  y: number
  w: number
  h: number
  /** Preformatted value label (unit already applied) — the layout emits the matching LabelEl. */
  valueLabel: string
}

export interface LinePathEl {
  kind: "line-path"
  d: string
}

export interface DotEl {
  kind: "dot"
  x: number
  y: number
}

export interface SparklineEl {
  kind: "sparkline"
  d: string
  trend: "up" | "down" | "flat"
}

export type SceneElement =
  | NodeBoxEl
  | ArrowEl
  | LabelEl
  | AxisEl
  | BarEl
  | LinePathEl
  | DotEl
  | SparklineEl

export interface Scene {
  width: number
  height: number
  elements: SceneElement[]
}
```

- [ ] **Step 4: Write `src/figures/svg.ts`**

```ts
import { escapeHtml } from "../core/inline"
import type {
  ArrowEl,
  BarEl,
  DotEl,
  LabelEl,
  LinePathEl,
  NodeBoxEl,
  Scene,
  SceneElement,
  SparklineEl,
} from "./scene"

export interface SceneSvgOptions {
  /** Accessible name, derived deterministically from the block's own fields. */
  ariaLabel: string
  /** Sketch pass (Task 6): rough.js hand-drawn strokes instead of clean shapes. */
  sketch?: boolean
  /** Deterministic seed for the sketch pass (block id, else content hash). */
  seed?: string
}

/** Format a number deterministically: integers plain, else up to 2 decimals. */
export function n2(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function nodeBox(el: NodeBoxEl, i: number): string {
  const rx = el.shape === "pill" ? el.h / 2 : el.shape === "round" ? 10 : el.shape === "note" ? 2 : 4
  return (
    `<g class="exp-node exp-node-${el.shape}" style="--draw-i:${i}">` +
    `<rect x="${n2(el.x)}" y="${n2(el.y)}" width="${n2(el.w)}" height="${n2(el.h)}" rx="${n2(rx)}"` +
    ` fill="var(--exp-node-fill)" stroke="var(--exp-node-stroke)"/>` +
    `<text x="${n2(el.x + el.w / 2)}" y="${n2(el.y + el.h / 2)}" text-anchor="middle" dominant-baseline="central" ` +
    `class="exp-node-label">${escapeHtml(el.label)}</text>` +
    `</g>`
  )
}

function arrow(el: ArrowEl, i: number): string {
  const cls = el.edgeKind === "causes" || el.edgeKind === "leads" ? "exp-edge" : `exp-edge exp-edge-${el.edgeKind}`
  const label =
    el.label && el.labelX !== undefined && el.labelY !== undefined
      ? `<text class="exp-fig-label exp-edge-label" text-anchor="middle" transform="translate(${n2(el.labelX)},${n2(el.labelY)})">${escapeHtml(el.label)}</text>`
      : ""
  return (
    `<g class="exp-arrow" style="--draw-i:${i}">` +
    `<path class="${cls}" d="${el.d}"/>` +
    `<path class="${cls}" d="${el.head}"/>` +
    label +
    `</g>`
  )
}

function label(el: LabelEl, i: number): string {
  const cls = el.emphasis ? "exp-fig-label exp-fig-label-emphasis" : "exp-fig-label"
  return (
    `<text class="${cls}" x="${n2(el.x)}" y="${n2(el.y)}" text-anchor="${el.anchor}" style="--draw-i:${i}">` +
    `${escapeHtml(el.text)}</text>`
  )
}

function axis(el: { x1: number; y1: number; x2: number; y2: number }, i: number): string {
  return (
    `<line class="exp-axis" x1="${n2(el.x1)}" y1="${n2(el.y1)}" x2="${n2(el.x2)}" y2="${n2(el.y2)}" ` +
    `style="--draw-i:${i}"/>`
  )
}

function bar(el: BarEl, i: number): string {
  return (
    `<rect class="exp-bar" x="${n2(el.x)}" y="${n2(el.y)}" width="${n2(el.w)}" height="${n2(el.h)}" ` +
    `style="--draw-i:${i}"/>`
  )
}

function linePath(el: LinePathEl, i: number): string {
  return `<path class="exp-line-path" d="${el.d}" style="--draw-i:${i}"/>`
}

function dot(el: DotEl, i: number): string {
  return `<circle class="exp-dot" cx="${n2(el.x)}" cy="${n2(el.y)}" r="4" style="--draw-i:${i}"/>`
}

function sparkline(el: SparklineEl, i: number): string {
  return `<path class="exp-sparkline exp-sparkline-${el.trend}" d="${el.d}" style="--draw-i:${i}"/>`
}

function cleanElement(el: SceneElement, i: number): string {
  switch (el.kind) {
    case "node-box":
      return nodeBox(el, i)
    case "arrow":
      return arrow(el, i)
    case "label":
      return label(el, i)
    case "axis":
      return axis(el, i)
    case "bar":
      return bar(el, i)
    case "line-path":
      return linePath(el, i)
    case "dot":
      return dot(el, i)
    case "sparkline":
      return sparkline(el, i)
  }
}

export function sceneToSvg(scene: Scene, opts: SceneSvgOptions): string {
  const body = scene.elements.map(cleanElement).join("")
  return (
    `<svg class="exp-figure" viewBox="0 0 ${n2(scene.width)} ${n2(scene.height)}" role="img" ` +
    `aria-label="${escapeHtml(opts.ariaLabel)}" xmlns="http://www.w3.org/2000/svg">` +
    `<title>${escapeHtml(opts.ariaLabel)}</title>` +
    body +
    `</svg>`
  )
}
```

(The sketch branch inside `sceneToSvg` is added in Task 6; `opts.sketch`/`opts.seed` are intentionally unused until then.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/figures/svg.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` — expected: no errors.

```bash
git add src/figures/scene.ts src/figures/svg.ts tests/figures/svg.test.ts
git commit -m "feat(figures): scene model and token-based SVG serializer"
```

---

### Task 2: Figure CSS (tokens, classes, sketch + draw hooks)

Lands **before** any primitive emits figure markup, so every later full-suite run passes the `themes.test.ts` class-coverage check.

**Files:**
- Modify: `src/themes/tokens.css`
- Modify: `src/themes/light.css`, `src/themes/dark.css`

**Interfaces:**
- Consumes: the full set of class names Tasks 1/3/4/5 will emit: `exp-figure`, `exp-node`, `exp-node-box`, `exp-node-round`, `exp-node-pill`, `exp-node-note`, `exp-node-label`, `exp-arrow`, `exp-edge`, `exp-edge-conflict`, `exp-edge-part`, `exp-edge-label`, `exp-fig-label`, `exp-fig-label-emphasis`, `exp-axis`, `exp-bar`, `exp-line-path`, `exp-dot`, `exp-sparkline`, `exp-sparkline-up|down|flat`, `exp-diagram`, `exp-chart`, `exp-fig-caption`, `exp-fig-empty`, `exp-cause-effect-figure`, `exp-timeline-figure`, `exp-spark-box`, `exp-sketch`, `exp-draw`.
- Produces: CSS custom properties `--exp-ink`, `--exp-edge`, `--exp-node-fill`, `--exp-node-stroke`, `--exp-node-text`.

- [ ] **Step 1: Add drawing tokens to the palette block in `src/themes/tokens.css`**

Inside `.exp { ... }`, after the `--exp-flat: #5c6470;` line:

```css
  /* figures */
  --exp-ink: #1a1d23;
  --exp-edge: #6b7280;
  --exp-node-fill: #ffffff;
  --exp-node-stroke: #2563eb;
  --exp-node-text: #1a1d23;
```

- [ ] **Step 2: Add the figure CSS to `src/themes/tokens.css`**

Append at the end of the file:

```css
/* Figures — svg emitted by the drawing layer. Colors only via tokens. */
.exp-figure {
  display: block;
  width: 100%;
  height: auto;
  margin: 4px 0 0;
}

.exp-figure text {
  font-family: var(--exp-font);
  font-size: 13px;
}

.exp-node rect {
  fill: var(--exp-node-fill);
  stroke: var(--exp-node-stroke);
  stroke-width: 1.5;
}

.exp-node-note rect {
  stroke-dasharray: 4 3;
}

.exp-node-pill text,
.exp-node-round text {
  font-weight: 600;
}

.exp-node-label {
  fill: var(--exp-node-text);
}

.exp-arrow {
  fill: none;
}

.exp-edge {
  fill: none;
  stroke: var(--exp-ink);
  stroke-width: 1.5;
}

.exp-edge-conflict {
  stroke: var(--exp-warning);
  stroke-dasharray: 5 4;
}

.exp-edge-part {
  stroke: var(--exp-text-muted);
  stroke-dasharray: 2 3;
}

.exp-edge-label {
  font-size: 11px;
}

.exp-fig-label {
  fill: var(--exp-text-muted);
}

.exp-fig-label-emphasis {
  fill: var(--exp-ink);
  font-weight: 650;
}

.exp-axis {
  stroke: var(--exp-edge);
  stroke-width: 1;
}

.exp-bar {
  fill: var(--exp-accent);
}

.exp-line-path {
  fill: none;
  stroke: var(--exp-accent);
  stroke-width: 2;
}

.exp-dot {
  fill: var(--exp-accent);
}

.exp-sparkline {
  fill: none;
  stroke-width: 2;
}

.exp-sparkline-up {
  stroke: var(--exp-up);
}

.exp-sparkline-down {
  stroke: var(--exp-down);
}

.exp-sparkline-flat {
  stroke: var(--exp-flat);
}

.exp-spark-box {
  display: block;
  margin-top: 8px;
  max-width: 120px;
}

.exp-fig-caption {
  margin: 6px 0 0;
  color: var(--exp-text-muted);
}

.exp-fig-empty {
  margin: 0;
  color: var(--exp-text-muted);
}

.exp-cause-effect-figure,
.exp-timeline-figure {
  padding: 12px;
}

/* Sketch pass: rough.js paths carry inline stroke/fill; keep them crisp. */
.exp-fig-sketch {
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Progressive draw (opt-in: exp-draw class on any ancestor). CSS-only;
   per-element order comes from the serializer's --draw-i custom property. */
@media (prefers-reduced-motion: no-preference) {
  .exp-draw .exp-figure path,
  .exp-draw .exp-figure rect,
  .exp-draw .exp-figure line,
  .exp-draw .exp-figure circle {
    stroke-dasharray: 600;
    stroke-dashoffset: 600;
    animation: exp-draw-in 900ms ease-out forwards;
    animation-delay: calc(var(--draw-i, 0) * 120ms);
  }

  .exp-draw .exp-figure text {
    opacity: 0;
    animation: exp-fade-in 400ms ease-out forwards;
    animation-delay: calc(var(--draw-i, 0) * 120ms + 500ms);
  }
}

@keyframes exp-draw-in {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes exp-fade-in {
  to {
    opacity: 1;
  }
}
```

Also add `.exp-diagram` and `.exp-chart` to the container-hooks selector list (the `.exp-text, … { min-width: 0; }` rule).

- [ ] **Step 3: Add token values to `src/themes/light.css`**

After `--exp-flat: #5c6470;` inside `.exp-theme-light { ... }`:

```css
  --exp-ink: #1a1d23;
  --exp-edge: #6b7280;
  --exp-node-fill: #ffffff;
  --exp-node-stroke: #2563eb;
  --exp-node-text: #1a1d23;
```

- [ ] **Step 4: Add token values to `src/themes/dark.css`**

After `--exp-flat: #9aa3ad;` inside `.exp-theme-dark { ... }`:

```css
  --exp-ink: #e6e8eb;
  --exp-edge: #4b5563;
  --exp-node-fill: #16181d;
  --exp-node-stroke: #60a5fa;
  --exp-node-text: #e6e8eb;
```

- [ ] **Step 5: Run theme tests and commit**

Run: `npx vitest run tests/themes.test.ts && npm run typecheck`
Expected: PASS (no new classes are emitted yet; tokens are additive).

```bash
git add src/themes/tokens.css src/themes/light.css src/themes/dark.css
git commit -m "feat(themes): figure tokens, classes, and exp-draw/exp-sketch hooks"
```

---

### Task 3: layoutFlow + `diagram` primitive

**Files:**
- Create: `src/figures/layoutFlow.ts`
- Create: `src/primitives/diagram.ts`
- Modify: `src/core/schema.ts` (append diagram schemas; extend `Block` union + `blockUnionSchema`)
- Modify: `src/core/registerAll.ts` (add import)
- Modify: `src/core/llm.ts` (append diagram docs to `systemPromptSnippet`)
- Modify: `tests/fixtures.ts` (add a diagram block to `allPrimitivesIr`)
- Test: `tests/figures/layout-flow.test.ts`, `tests/diagram.test.ts`

**Interfaces:**
- Consumes: `Scene`/`SceneElement` (Task 1), `sceneToSvg` (Task 1), `registerPrimitive` from `src/core/registry.ts`, `idSchema` from `src/core/schema.ts`.
- Produces: `layoutFlow(spec: FlowSpec): FlowLayoutResult` where `FlowSpec = { nodes: FlowNodeSpec[]; edges: FlowEdgeSpec[]; direction?: "lr" | "tb" }`, `FlowNodeSpec = { id: string; label: string; shape?: NodeShape }`, `FlowEdgeSpec = { from: string; to: string; label?: string; kind?: EdgeKind }`, `FlowLayoutResult = { scene: Scene; warnings: string[] }`. Task 5's cause-effect figure form reuses this. `diagramBlockSchema`, `DiagramBlock` exported via `schema.ts`.

- [ ] **Step 1: Write the failing layout tests**

```ts
// tests/figures/layout-flow.test.ts
import { describe, expect, it } from "vitest"
import { layoutFlow } from "../../src/figures/layoutFlow"

describe("layoutFlow", () => {
  it("layers lr: sources in column 0, targets in column 1", () => {
    const { scene, warnings } = layoutFlow({
      nodes: [
        { id: "a", label: "Start" },
        { id: "b", label: "Finish" },
      ],
      edges: [{ from: "a", to: "b", kind: "causes" }],
      direction: "lr",
    })
    expect(warnings).toEqual([])
    const a = scene.elements.find(e => e.kind === "node-box" && e.id === "a")!
    const b = scene.elements.find(e => e.kind === "node-box" && e.id === "b")!
    expect(a.x).toBeLessThan(b.x)
    expect(a.y).toBe(b.y)
    expect(scene.elements.some(e => e.kind === "arrow")).toBe(true)
  })

  it("flows top-to-bottom for tb direction (height exceeds width)", () => {
    const { scene } = layoutFlow({
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [{ from: "a", to: "c" }, { from: "b", to: "c" }],
      direction: "tb",
    })
    const a = scene.elements.find(e => e.kind === "node-box" && e.id === "a")!
    const c = scene.elements.find(e => e.kind === "node-box" && e.id === "c")!
    expect(c.y).toBeGreaterThan(a.y)
    expect(scene.height).toBeGreaterThan(scene.width)
  })

  it("drops dangling edges with a warning and still renders nodes", () => {
    const { scene, warnings } = layoutFlow({
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "ghost" }],
    })
    expect(scene.elements.some(e => e.kind === "node-box")).toBe(true)
    expect(scene.elements.some(e => e.kind === "arrow")).toBe(false)
    expect(warnings.some(w => w.includes("figure-edge-dangling"))).toBe(true)
  })

  it("keeps the first duplicate node and warns", () => {
    const { scene, warnings } = layoutFlow({
      nodes: [
        { id: "a", label: "First" },
        { id: "a", label: "Second" },
      ],
      edges: [],
    })
    expect(scene.elements.filter(e => e.kind === "node-box")).toHaveLength(1)
    expect(warnings.some(w => w.includes("figure-node-duplicate"))).toBe(true)
  })

  it("drops self-edges with a warning", () => {
    const { warnings } = layoutFlow({
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "a" }],
    })
    expect(warnings.some(w => w.includes("figure-edge-self"))).toBe(true)
  })

  it("sizes boxes from label length (clamped)", () => {
    const { scene } = layoutFlow({
      nodes: [{ id: "tiny", label: "ab" }, { id: "huge", label: "x".repeat(80) }],
      edges: [],
    })
    const tiny = scene.elements.find(e => e.kind === "node-box" && e.id === "tiny")!
    const huge = scene.elements.find(e => e.kind === "node-box" && e.id === "huge")!
    expect(tiny.w).toBe(90) // min width
    expect(huge.w).toBe(260) // max width
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/figures/layout-flow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/figures/layoutFlow.ts`**

```ts
import type { EdgeKind, NodeShape, Scene } from "./scene"

export interface FlowNodeSpec {
  id: string
  label: string
  shape?: NodeShape
}

export interface FlowEdgeSpec {
  from: string
  to: string
  label?: string
  kind?: EdgeKind
}

export interface FlowSpec {
  nodes: FlowNodeSpec[]
  edges: FlowEdgeSpec[]
  direction?: "lr" | "tb"
}

export interface FlowLayoutResult {
  scene: Scene
  warnings: string[]
}

const NODE_W_MIN = 90
const NODE_W_MAX = 260
const NODE_H = 44
const GAP_MAIN = 64 // gap between columns (lr) or rows (tb)
const GAP_CROSS = 28 // gap between rows (lr) or columns (tb)
const PAD = 16

/** Deterministic width estimate: ~7.5px/char at 13px, clamped. */
export function nodeWidth(label: string): number {
  return Math.min(NODE_W_MAX, Math.max(NODE_W_MIN, Math.round(label.length * 7.5) + 24))
}

interface Placed {
  id: string
  label: string
  shape: NodeShape
  x: number
  y: number
  w: number
  h: number
}

export function layoutFlow(spec: FlowSpec): FlowLayoutResult {
  const warnings: string[] = []
  const direction = spec.direction ?? "lr"

  // 1. Dedupe nodes by id (keep first).
  const nodes: FlowNodeSpec[] = []
  const seen = new Set<string>()
  for (const n of spec.nodes) {
    if (seen.has(n.id)) {
      warnings.push(`figure-node-duplicate: node id "${n.id}" appears more than once; keeping the first`)
      continue
    }
    seen.add(n.id)
    nodes.push(n)
  }
  const byId = new Map(nodes.map(n => [n.id, n]))

  // 2. Keep only edges whose endpoints exist; drop self-edges.
  const edges: FlowEdgeSpec[] = []
  for (const e of spec.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) {
      warnings.push(`figure-edge-dangling: edge "${e.from}"→"${e.to}" references an unknown node; dropped`)
      continue
    }
    if (e.from === e.to) {
      warnings.push(`figure-edge-self: edge on node "${e.from}" dropped`)
      continue
    }
    edges.push(e)
  }

  // 3. Longest-path layering via capped relaxation (deterministic even with
  //    cycles: capped at nodes.length passes, so cyclic layers stabilize).
  const layer = new Map<string, number>(nodes.map(n => [n.id, 0]))
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false
    for (const e of edges) {
      const next = layer.get(e.from)! + 1
      if (next > layer.get(e.to)!) {
        layer.set(e.to, next)
        changed = true
      }
    }
    if (!changed) break
  }

  // 4. Column/row membership in spec order (stable).
  const maxLayer = Math.max(0, ...nodes.map(n => layer.get(n.id)!))
  const ranks: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const n of nodes) ranks[layer.get(n.id)!].push(n.id)

  // 5. Positions.
  const thickness = NODE_H + GAP_CROSS // cross-axis pitch
  const mainSizes = ranks.map(rankIds => Math.max(0, ...rankIds.map(id => nodeWidth(byId.get(id)!.label))))
  const placed = new Map<string, Placed>()
  let mainOffset = PAD
  ranks.forEach((rankIds, r) => {
    rankIds.forEach((id, i) => {
      const n = byId.get(id)!
      const w = nodeWidth(n.label)
      const cross = PAD + i * thickness
      placed.set(id, {
        id,
        label: n.label,
        shape: n.shape ?? "box",
        w,
        h: NODE_H,
        x: direction === "lr" ? mainOffset : cross,
        y: direction === "lr" ? cross : mainOffset,
      })
    })
    mainOffset += mainSizes[r] + GAP_MAIN
  })
  const crossCount = Math.max(1, ...ranks.map(r => r.length))
  const width = direction === "lr" ? mainOffset - GAP_MAIN + PAD : PAD * 2 + crossCount * thickness - GAP_CROSS
  const height = direction === "lr" ? PAD * 2 + crossCount * thickness - GAP_CROSS : mainOffset - GAP_MAIN + PAD

  // 6. Edges: cubic shaft + explicit arrowhead triangle (no <defs>/marker ids —
  //    multiple figures per page must not collide).
  const elements: Scene["elements"] = [...placed.values()].map(p => ({
    kind: "node-box" as const,
    ...p,
  }))
  for (const e of edges) {
    const a = placed.get(e.from)!
    const b = placed.get(e.to)!
    let d: string
    let head: string
    let labelX: number
    let labelY: number
    if (direction === "lr") {
      const sx = a.x + a.w
      const sy = a.y + a.h / 2
      const tx = b.x - 2
      const ty = b.y + b.h / 2
      const mx = (sx + tx) / 2
      d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`
      head = `M ${tx} ${ty} L ${tx - 9} ${ty - 4.5} L ${tx - 9} ${ty + 4.5} Z`
      labelX = mx
      labelY = (sy + ty) / 2 - 6
    } else {
      const sx = a.x + a.w / 2
      const sy = a.y + a.h
      const tx = b.x + b.w / 2
      const ty = b.y - 2
      const my = (sy + ty) / 2
      d = `M ${sx} ${sy} C ${sx} ${my}, ${tx} ${my}, ${tx} ${ty}`
      head = `M ${tx} ${ty} L ${tx - 4.5} ${ty - 9} L ${tx + 4.5} ${ty - 9} Z`
      labelX = sx
      labelY = my - 6
    }
    elements.push({ kind: "arrow", d, head, edgeKind: e.kind ?? "leads", label: e.label, labelX, labelY })
  }

  return { scene: { width: Math.max(width, 240), height: Math.max(height, 76), elements }, warnings }
}
```

- [ ] **Step 4: Add diagram schemas to `src/core/schema.ts`**

Append at the end of the file:

```ts
export const diagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  shape: z.enum(["box", "round", "pill", "note"]).optional(),
})
export type DiagramNode = z.infer<typeof diagramNodeSchema>

export const diagramEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: z.enum(["causes", "leads", "part-of", "conflict"]).optional(),
})
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>

export const diagramBlockSchema = z.object({
  id: idSchema,
  type: z.literal("diagram"),
  nodes: z.array(diagramNodeSchema).min(1),
  edges: z.array(diagramEdgeSchema),
  direction: z.enum(["lr", "tb"]).optional(),
})
export type DiagramBlock = z.infer<typeof diagramBlockSchema>
```

Add `diagramBlockSchema` to the `blockUnionSchema` discriminated union (after `stackBlockSchema`):

```ts
    stackBlockSchema,
    diagramBlockSchema,
  ]) as unknown as z.ZodType<Block>,
```

…and add `DiagramBlock` to the `Block` union type:

```ts
  | StackBlock
  | DiagramBlock
```

- [ ] **Step 5: Write `src/primitives/diagram.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { diagramBlockSchema, type DiagramBlock } from "../core/schema"
import { layoutFlow, type FlowSpec } from "../figures/layoutFlow"
import { sceneToSvg } from "../figures/svg"

export function renderDiagram(block: DiagramBlock, ctx: RenderContext): string {
  const spec: FlowSpec = {
    nodes: block.nodes.map(n => ({ id: n.id, label: n.label, shape: n.shape })),
    edges: block.edges.map(e => ({ from: e.from, to: e.to, label: e.label, kind: e.kind })),
    direction: block.direction ?? "lr",
  }
  const { scene, warnings } = layoutFlow(spec)
  for (const w of warnings) ctx.addWarning(w)
  // Deterministic accessible name from the block's own fields (spec §2).
  const aria = `Diagram: ${block.nodes.map(n => n.label).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria })
  return `<div class="exp-block exp-diagram">${svg}</div>`
}

registerPrimitive("diagram", { schema: diagramBlockSchema, render: renderDiagram })
```

- [ ] **Step 6: Register + document**

`src/core/registerAll.ts` — add after the derivation import:

```ts
import "../primitives/diagram"
```

`src/core/llm.ts` — append to the block types section of `systemPromptSnippet` (before the `stack:` line):

```
- diagram: { nodes: [{ id, label, shape?: "box"|"round"|"pill"|"note" }], edges: [{ from, to, label?, kind?: "causes"|"leads"|"part-of"|"conflict" }], direction?: "lr"|"tb" } — semantic nodes/edges only; the renderer computes all layout. Edge from/to must reference node ids.
```

- [ ] **Step 7: Add a diagram to `tests/fixtures.ts`**

Insert before the final `chart` entry in `allPrimitivesIr.blocks`:

```ts
    {
      type: "diagram",
      nodes: [
        { id: "a", label: "Input" },
        { id: "b", label: "Transform" },
        { id: "c", label: "Output" },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    },
```

- [ ] **Step 8: Write the primitive test**

```ts
// tests/diagram.test.ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { diagramBlockSchema } from "../src/core/schema"
import "../src/core/registerAll"

describe("diagram", () => {
  const ir = {
    version: 1,
    blocks: [
      {
        type: "diagram",
        nodes: [
          { id: "a", label: "Deploy ships", shape: "pill" },
          { id: "b", label: "Latency spikes" },
          { id: "c", label: "Rollback", shape: "round" },
        ],
        edges: [
          { from: "a", to: "b", kind: "causes" },
          { from: "b", to: "c", kind: "leads", label: "then" },
          { from: "a", to: "ghost", kind: "causes" },
        ],
        direction: "lr" as const,
      },
    ],
  }

  it("schema accepts a diagram block", () => {
    expect(diagramBlockSchema.safeParse(ir.blocks[0]).success).toBe(true)
  })

  it("renders themed svg with node labels and edge classes", () => {
    const { html, warnings } = renderExplanation(ir)
    expect(html).toContain(`<div class="exp-block exp-diagram">`)
    expect(html).toContain(`<svg class="exp-figure"`)
    expect(html).toContain(`role="img"`)
    expect(html).toContain(`aria-label="Diagram: Deploy ships → Latency spikes → Rollback"`)
    expect(html).toContain(`Deploy ships`)
    expect(html).not.toContain(`exp-edge-conflict`) // no conflict edge in this fixture
    expect(html).toContain(`>then</text>`)
    expect(warnings.some(w => w.includes("figure-edge-dangling"))).toBe(true)
  })

  it("escapes node labels", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "diagram",
          nodes: [{ id: "a", label: "<img src=x onerror=alert(1)>" }],
          edges: [],
        },
      ],
    })
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
  })
})
```

- [ ] **Step 9: Run the full suite and commit**

Run: `npm test && npm run typecheck`
Expected: all PASS — `llm.test.ts` sees `diagram` in the snippet and registry; `themes.test.ts` finds every emitted class (Task 2 CSS).

```bash
git add src/figures/layoutFlow.ts src/primitives/diagram.ts src/core/schema.ts src/core/registerAll.ts src/core/llm.ts tests/fixtures.ts tests/diagram.test.ts tests/figures/layout-flow.test.ts
git commit -m "feat(diagram): semantic nodes/edges block with layered flow layout"
```

---

### Task 4: `chart` primitive + layoutChart + unknown-fixture swaps

**Files:**
- Create: `src/figures/layoutChart.ts`
- Create: `src/primitives/chart.ts`
- Modify: `src/core/schema.ts` (append chart schema; extend `Block` union + `blockUnionSchema`)
- Modify: `src/core/registerAll.ts`
- Modify: `src/core/llm.ts`
- Modify: `tests/render.test.ts`, `tests/react.test.tsx`, `tests/fixtures.ts`, `tests/demo-examples.test.ts` (all use `chart` as the *unknown* type today — registering it flips their behavior)
- Modify: `demo/examples.js`, `demo/server.mjs` (capabilities fixture uses `chart` as unknown)
- Test: `tests/chart.test.ts`, `tests/figures/layout-chart.test.ts`

**Interfaces:**
- Consumes: `Scene`/`sceneToSvg` (Task 1), `registerPrimitive`, `idSchema`.
- Produces: `layoutChart(spec: ChartSpec): ChartLayoutResult` with `ChartSpec = { kind: "bar" | "line"; points: { label: string; value: number }[]; unit?: string; caption?: string }`, `ChartLayoutResult = { scene: Scene; warnings: string[] }`; `layoutSparkline(series: number[], w?: number, h?: number): { d: string; trend: "up" | "down" | "flat" }` (used by Task 5); `chartBlockSchema`, `ChartBlock` via `schema.ts`.

- [ ] **Step 1: Write the failing layout tests**

```ts
// tests/figures/layout-chart.test.ts
import { describe, expect, it } from "vitest"
import { layoutChart, layoutSparkline } from "../../src/figures/layoutChart"

describe("layoutChart", () => {
  it("bars: tallest value gets the full plot height; labels carry the unit", () => {
    const { scene, warnings } = layoutChart({
      kind: "bar",
      points: [
        { label: "Mon", value: 120 },
        { label: "Tue", value: 240 },
      ],
      unit: "ms",
    })
    expect(warnings).toEqual([])
    const bars = scene.elements.filter(e => e.kind === "bar")
    expect(bars).toHaveLength(2)
    const [a, b] = bars as [{ y: number; h: number }, { y: number; h: number }]
    expect(b.h).toBeGreaterThan(a.h)
    expect(b.y).toBeLessThan(a.y)
    const texts = scene.elements.filter(e => e.kind === "label").map(e => (e as { text: string }).text)
    expect(texts).toContain("240ms")
    expect(texts).toContain("Tue")
  })

  it("line: one path through all points, dots at each point", () => {
    const { scene } = layoutChart({
      kind: "line",
      points: [
        { label: "a", value: 1 },
        { label: "b", value: 3 },
        { label: "c", value: 2 },
      ],
    })
    const line = scene.elements.find(e => e.kind === "line-path")!
    expect((line as { d: string }).d.startsWith("M ")).toBe(true)
    expect((line as { d: string }).d.split(" L ").length).toBe(3)
    expect(scene.elements.filter(e => e.kind === "dot")).toHaveLength(3)
  })

  it("clamps negative values to 0 with a warning", () => {
    const { scene, warnings } = layoutChart({
      kind: "bar",
      points: [{ label: "a", value: -5 }, { label: "b", value: 10 }],
    })
    expect(warnings.some(w => w.includes("figure-chart-value"))).toBe(true)
    const bars = scene.elements.filter(e => e.kind === "bar")
    expect((bars[0] as { h: number }).h).toBe(0)
  })

  it("is deterministic", () => {
    const spec = { kind: "bar" as const, points: [{ label: "a", value: 1 }] }
    expect(JSON.stringify(layoutChart(spec).scene)).toBe(JSON.stringify(layoutChart(spec).scene))
  })
})

describe("layoutSparkline", () => {
  it("classifies trend from first vs last", () => {
    expect(layoutSparkline([1, 2, 3]).trend).toBe("up")
    expect(layoutSparkline([3, 2, 1]).trend).toBe("down")
    expect(layoutSparkline([2, 2, 2]).trend).toBe("flat")
  })

  it("fits the series into the given box", () => {
    const { d } = layoutSparkline([0, 100], 84, 28)
    expect(d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/figures/layout-chart.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/figures/layoutChart.ts`**

```ts
import type { Scene } from "./scene"

export interface ChartPoint {
  label: string
  value: number
}

export interface ChartSpec {
  kind: "bar" | "line"
  points: ChartPoint[]
  unit?: string
  caption?: string
}

export interface ChartLayoutResult {
  scene: Scene
  warnings: string[]
}

const W = 460
const H = 220
const PAD_L = 34
const PAD_R = 12
const PAD_T = 16
const PAD_B = 28

function fmtValue(v: number, unit?: string): string {
  const num = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  return unit ? `${num}${unit}` : num
}

export function layoutChart(spec: ChartSpec): ChartLayoutResult {
  const warnings: string[] = []
  const points = spec.points.map(p => {
    if (p.value < 0) {
      warnings.push(`figure-chart-value: negative value for "${p.label}" clamped to 0`)
      return { label: p.label, value: 0 }
    }
    return p
  })

  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const baseline = PAD_T + plotH
  const max = Math.max(1, ...points.map(p => p.value))

  const elements: Scene["elements"] = [{ kind: "axis", x1: PAD_L, y1: baseline, x2: W - PAD_R, y2: baseline }]
  const xAt = (i: number, n: number) => (n === 1 ? PAD_L + plotW / 2 : PAD_L + (i * plotW) / (n - 1))
  const yAt = (v: number) => baseline - (v / max) * plotH

  if (spec.kind === "bar") {
    const band = plotW / points.length
    const bw = band * 0.6
    points.forEach((p, i) => {
      const h = yAt(0) - yAt(p.value)
      const x = PAD_L + i * band + (band - bw) / 2
      const y = baseline - h
      elements.push({ kind: "bar", x, y, w: bw, h, valueLabel: fmtValue(p.value, spec.unit) })
      elements.push({ kind: "label", x: x + bw / 2, y: y - 6, text: fmtValue(p.value, spec.unit), anchor: "middle", emphasis: true })
      elements.push({ kind: "label", x: x + bw / 2, y: baseline + 16, text: p.label, anchor: "middle" })
    })
  } else {
    const n = points.length
    points.forEach((p, i) => {
      const x = xAt(i, n)
      const y = yAt(p.value)
      elements.push({ kind: "dot", x, y })
      elements.push({ kind: "label", x, y: y - 8, text: fmtValue(p.value, spec.unit), anchor: "middle", emphasis: true })
      elements.push({ kind: "label", x, y: baseline + 16, text: p.label, anchor: "middle" })
    })
    const coords = points.map((p, i) => `${xAt(i, n)} ${yAt(p.value)}`)
    elements.push({ kind: "line-path", d: `M ${coords.join(" L ")}` })
  }

  return { scene: { width: W, height: H, elements }, warnings }
}

export function layoutSparkline(
  series: number[],
  w = 84,
  h = 28,
): { d: string; trend: "up" | "down" | "flat" } {
  const pad = 2
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const step = series.length > 1 ? (w - pad * 2) / (series.length - 1) : 0
  const coords = series.map((v, i) => {
    const x = pad + i * step
    const y = pad + (1 - (v - min) / span) * (h - pad * 2)
    return `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`
  })
  const delta = series[series.length - 1] - series[0]
  const trend = delta > 1e-9 ? "up" : delta < -1e-9 ? "down" : "flat"
  return { d: `M ${coords.join(" L ")}`, trend }
}
```

- [ ] **Step 4: Add chart schema to `src/core/schema.ts`**

Append:

```ts
export const chartBlockSchema = z.object({
  id: idSchema,
  type: z.literal("chart"),
  kind: z.enum(["bar", "line"]),
  // Lenient like stack children: per-point validation happens at render time,
  // so one malformed point drops the point instead of the whole chart (spec §1).
  points: z.array(z.unknown()),
  unit: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
})
export type ChartBlock = z.infer<typeof chartBlockSchema>
```

Add `chartBlockSchema` to the union list and `ChartBlock` to the `Block` type (same two spots as Task 3).

- [ ] **Step 5: Write `src/primitives/chart.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { chartBlockSchema, type ChartBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import { layoutChart, type ChartPoint } from "../figures/layoutChart"
import { sceneToSvg } from "../figures/svg"

/** Lenient per-point parsing (spec §1): a malformed point is dropped with a
 *  warning, not fatal. Mirrors how stack children are salvaged. */
function parsePoints(raw: unknown[], warnings: string[]): ChartPoint[] {
  const points: ChartPoint[] = []
  raw.forEach((p, i) => {
    const rec = typeof p === "object" && p !== null ? (p as Record<string, unknown>) : null
    const label = typeof rec?.label === "string" && rec.label.trim() !== "" ? rec.label : null
    const rawValue = rec?.value
    const value =
      typeof rawValue === "number" && Number.isFinite(rawValue)
        ? rawValue
        : typeof rawValue === "string" && /^-?\d+(\.\d+)?$/.test(rawValue)
          ? Number(rawValue)
          : null
    if (!label || value === null) {
      warnings.push(`figure-point-invalid: chart point ${i} dropped — needs a label and a numeric value`)
      return
    }
    points.push({ label, value })
  })
  return points
}

export function renderChart(block: ChartBlock, ctx: RenderContext): string {
  const warnings: string[] = []
  const points = parsePoints(block.points, warnings)
  for (const w of warnings) ctx.addWarning(w)
  if (points.length === 0) {
    return `<div class="exp-block exp-chart"><p class="exp-fig-empty">Chart data could not be read.</p></div>`
  }
  const { scene } = layoutChart({ kind: block.kind, points, unit: block.unit, caption: block.caption })
  const aria = block.caption ?? `Chart: ${points.map(p => p.label).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria })
  const caption = block.caption ? `<p class="exp-fig-caption">${renderInline(block.caption)}</p>` : ""
  return `<div class="exp-block exp-chart">${svg}${caption}</div>`
}

registerPrimitive("chart", { schema: chartBlockSchema, render: renderChart })
```

- [ ] **Step 6: Register + document + swap the unknown-type fixtures**

`src/core/registerAll.ts` — add after the diagram import:

```ts
import "../primitives/chart"
```

`src/core/llm.ts` — append to the block types section (after the diagram line):

```
- chart: { kind: "bar"|"line", points: [{ label, value }], unit?, caption? } — value is a number or numeric string; line points are an ordered series.
```

`tests/render.test.ts` — the "unknown types" test currently uses `chart`; it now registers. Swap to a permanently-unknown type:

```ts
  it("renders unknown types as a styled fallback with a warning", () => {
    const { html, warnings } = renderExplanation({ version: 1, blocks: [{ type: "mindmap", title: "Sales" }] })
    expect(html).toContain("exp-fallback")
    expect(html).toContain("mindmap")
    expect(html).toContain("Sales")
    expect(warnings.some(w => w.includes("unknown type"))).toBe(true)
  })
```

`tests/react.test.tsx` — same swap in "renders unknown types through the core fallback":

```tsx
    const html = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [{ type: "mindmap", title: "Sales" }] }} theme="none" />,
    )
    expect(html).toContain("exp-fallback")
```

`tests/fixtures.ts` — the trailing `{ type: "chart", title: "Unknown fallback" }` entry in `allPrimitivesIr` becomes a real chart (the unknown-block demonstration lives in the demo's capabilities fixture):

```ts
    { type: "chart", kind: "bar", points: [{ label: "A", value: 1 }, { label: "B", value: 2 }] },
```

`demo/examples.js` — capabilities fixture keeps demonstrating leniency with a different invented type:

```js
    { type: "gauge", title: "Weekly activations", series: [3, 4, 12] },
```

…and update the prose above it: "the model invented a `gauge` block type".

`demo/server.mjs` — update the capabilities copy: "invented a <code>gauge</code> block type".

`tests/demo-examples.test.ts` — update the intentional-unknown assertion:

```ts
    expect(types.has("gauge")).toBe(true) // unknown → fallback
```

- [ ] **Step 7: Write the primitive tests**

```ts
// tests/chart.test.ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { chartBlockSchema } from "../src/core/schema"
import "../src/core/registerAll"

describe("chart", () => {
  it("schema accepts numeric and numeric-string values", () => {
    expect(
      chartBlockSchema.safeParse({
        type: "chart",
        kind: "bar",
        points: [{ label: "a", value: 1 }, { label: "b", value: "2.5" }],
      }).success,
    ).toBe(true)
  })

  it("renders bar chart with unit and caption", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "chart",
          kind: "bar",
          points: [{ label: "Mon", value: 120 }, { label: "Tue", value: 240 }],
          unit: "ms",
          caption: "p95 by day",
        },
      ],
    })
    expect(html).toContain(`<div class="exp-block exp-chart">`)
    expect(html).toContain(`<svg class="exp-figure"`)
    expect(html).toContain(`aria-label="p95 by day"`)
    expect(html).toContain(">240ms</text>")
    expect(html).toContain(`<p class="exp-fig-caption">p95 by day</p>`)
    expect(warnings).toEqual([])
  })

  it("drops malformed points with a warning and keeps the rest", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        { type: "chart", kind: "line", points: [{ label: "a", value: 1 }, { label: "b" }, "junk", { label: "c", value: "3" }] },
      ],
    })
    expect(warnings.filter(w => w.includes("figure-point-invalid"))).toHaveLength(2)
    expect((html.match(/>a<\/text>/g) ?? []).length).toBe(1)
    expect((html.match(/>c<\/text>/g) ?? []).length).toBe(1)
  })

  it("renders an empty-state message when no point survives", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", kind: "bar", points: [{ value: "x" }] }],
    })
    expect(html).toContain("exp-fig-empty")
    expect(warnings.some(w => w.includes("figure-point-invalid"))).toBe(true)
  })

  it("escapes labels and captions", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", kind: "bar", points: [{ label: "<x>", value: 1 }], caption: "<script>y</script>" }],
    })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })
})
```

- [ ] **Step 8: Run everything and commit**

Run: `npm test && npm run typecheck`
Expected: all PASS — including `llm.test.ts` (snippet mentions chart) and the swapped fixtures.

```bash
git add src/figures/layoutChart.ts src/primitives/chart.ts src/core/schema.ts src/core/registerAll.ts src/core/llm.ts tests/render.test.ts tests/react.test.tsx tests/fixtures.ts tests/chart.test.ts tests/figures/layout-chart.test.ts tests/demo-examples.test.ts demo/examples.js demo/server.mjs
git commit -m "feat(chart): bar/line chart primitive with lenient per-point salvage"
```

---

### Task 5: `presentation` field + figure forms of cause-effect, timeline, data-callout

**Files:**
- Modify: `src/core/schema.ts` (`presentationSchema` + field on the three blocks; `series` on data-callout)
- Modify: `src/core/llm.ts`
- Create: `src/figures/layoutTimeline.ts`
- Modify: `src/primitives/cause-effect.ts`, `src/primitives/timeline.ts`, `src/primitives/data-callout.ts`
- Modify: `tests/concept-cause-derivation.test.ts`, `tests/comparison-timeline.test.ts` (pin existing markup with `presentation: "text"`)
- Test: `tests/presentation.test.ts`, `tests/figures/layout-timeline.test.ts`

**Interfaces:**
- Consumes: `layoutFlow` (Task 3), `layoutSparkline` (Task 4), `sceneToSvg` (Task 1), `renderInline`/`escapeHtml`.
- Produces: `presentationSchema = z.enum(["auto","text","figure"])`, `Presentation` type; `layoutTimeline(events: { when: string; what: string }[]): TimelineLayoutResult` with `TimelineLayoutResult = { scene: Scene; warnings: string[] }`. Note: `RenderContext.sketch` does not exist yet (Task 6); these renderers render clean SVG this task and gain the sketch pass-through in Task 6.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/figures/layout-timeline.test.ts
import { describe, expect, it } from "vitest"
import { layoutTimeline } from "../../src/figures/layoutTimeline"

describe("layoutTimeline", () => {
  it("places events on a horizontal spine, alternating above/below", () => {
    const { scene, warnings } = layoutTimeline([
      { when: "Sep 12", what: "Ships" },
      { when: "Sep 14", what: "Spikes" },
      { when: "Sep 18", what: "Holds" },
    ])
    expect(warnings).toEqual([])
    const dots = scene.elements.filter(e => e.kind === "dot")
    expect(dots).toHaveLength(3)
    const labels = scene.elements.filter(e => e.kind === "label") as { y: number; text: string }[]
    const above = labels.filter(l => l.y < 90)
    const below = labels.filter(l => l.y > 90)
    expect(above.length).toBeGreaterThan(0)
    expect(below.length).toBeGreaterThan(0)
    expect(above.some(l => l.text === "Sep 12")).toBe(true)
    expect(below.some(l => l.text === "Sep 14")).toBe(true)
  })

  it("widens for many events", () => {
    const one = layoutTimeline([{ when: "t0", what: "only" }])
    const many = layoutTimeline(Array.from({ length: 12 }, (_, i) => ({ when: `t${i}`, what: `event ${i}` })))
    expect(many.scene.width).toBeGreaterThan(one.scene.width)
  })
})
```

```ts
// tests/presentation.test.ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { explanationSchema } from "../src/core/schema"
import "../src/core/registerAll"

const chain3 = [
  { because: "b1", therefore: "t1" },
  { because: "b2", therefore: "t2" },
  { because: "b3", therefore: "t3" },
]
const chain7 = Array.from({ length: 7 }, (_, i) => ({ because: `b${i}`, therefore: `t${i}` }))

describe("presentation: cause-effect", () => {
  it("auto renders a figure for chains of ≤5 links", () => {
    const { html, warnings } = renderExplanation({ version: 1, blocks: [{ type: "cause-effect", chain: chain3 }] })
    expect(html).toContain(`<svg class="exp-figure"`)
    expect(html).toContain(`aria-label="Cause and effect: b1 → t1; b2 → t2; b3 → t3"`)
    expect(warnings).toEqual([])
  })

  it("auto falls back to text rows beyond 5 links", () => {
    const { html } = renderExplanation({ version: 1, blocks: [{ type: "cause-effect", chain: chain7 }] })
    expect(html).toContain(`<ol class="exp-cause-chain">`)
    expect(html).not.toContain(`exp-figure`)
  })

  it("presentation text forces the legacy markup; figure forces svg even for 1 link", () => {
    const text = renderExplanation({
      version: 1,
      blocks: [{ type: "cause-effect", chain: chain3, presentation: "text" }],
    })
    expect(text.html).toContain(`<ol class="exp-cause-chain">`)
    const fig = renderExplanation({
      version: 1,
      blocks: [{ type: "cause-effect", chain: [{ because: "b", therefore: "t" }], presentation: "figure" }],
    })
    expect(fig.html).toContain(`<svg class="exp-figure"`)
  })
})

describe("presentation: timeline", () => {
  it("auto renders a figure for up to 12 events", () => {
    const events = Array.from({ length: 3 }, (_, i) => ({ when: `t${i}`, what: `what ${i}` }))
    const { html } = renderExplanation({ version: 1, blocks: [{ type: "timeline", events }] })
    expect(html).toContain(`<svg class="exp-figure"`)
    expect(html).toContain(`aria-label="Timeline: t0 what 0 → t1 what 1 → t2 what 2"`)
  })

  it("auto falls back to text beyond 12 events; text forces legacy markup", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ when: `t${i}`, what: `w${i}` }))
    const auto = renderExplanation({ version: 1, blocks: [{ type: "timeline", events: many }] })
    expect(auto.html).toContain(`<ol class="exp-timeline-events">`)
    const forced = renderExplanation({
      version: 1,
      blocks: [{ type: "timeline", events: [{ when: "1990", what: "Penicillin" }], presentation: "text" }],
    })
    expect(forced.html).toContain(`<span class="exp-event-when">1990</span>`)
  })
})

describe("presentation: data-callout", () => {
  it("auto renders the sparkline figure when a series is present", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "data-callout", metric: "42%", label: "Pass rate", trend: "up", series: [1, 2, 4, 3, 5] }],
    })
    expect(html).toContain(`class="exp-sparkline exp-sparkline-up"`)
    expect(html).toContain(`aria-label="42% Pass rate trend up"`)
    expect(html).toContain(`<span class="exp-metric">42%</span>`) // number stays HTML
  })

  it("auto stays text without a series; figure without a series degrades to text", () => {
    const base = { type: "data-callout", metric: "42%", label: "L" } as const
    const auto = renderExplanation({ version: 1, blocks: [base] })
    expect(auto.html).not.toContain(`exp-figure`)
    const forced = renderExplanation({ version: 1, blocks: [{ ...base, presentation: "figure" }] })
    expect(forced.html).not.toContain(`exp-figure`)
  })
})

describe("presentation: data-callout schema", () => {
  it("rejects a one-sample series and accepts two-plus", () => {
    expect(
      explanationSchema.safeParse({
        version: 1,
        blocks: [{ type: "data-callout", metric: "m", label: "l", series: [1] }],
      }).success,
    ).toBe(false)
    expect(
      explanationSchema.safeParse({
        version: 1,
        blocks: [{ type: "data-callout", metric: "m", label: "l", series: [1, 2] }],
      }).success,
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/presentation.test.ts tests/figures/layout-timeline.test.ts`
Expected: FAIL — `presentation` is unknown to the schemas (zod strips it, so figure assertions fail) and `layoutTimeline` is missing.

- [ ] **Step 3: Schema changes in `src/core/schema.ts`**

Append:

```ts
export const presentationSchema = z.enum(["auto", "text", "figure"])
export type Presentation = z.infer<typeof presentationSchema>
```

Modify the three block schemas. `dataCalloutBlockSchema` becomes:

```ts
export const dataCalloutBlockSchema = z.object({
  id: idSchema,
  type: z.literal("data-callout"),
  metric: z.string().min(1),
  label: z.string().min(1),
  delta: z.string().min(1).optional(),
  trend: z.enum(["up", "down", "flat"]).optional(),
  series: z.array(z.number()).min(2).max(24).optional(),
  presentation: presentationSchema.optional(),
  context: z.string().min(1).optional(),
})
```

`causeEffectBlockSchema` and `timelineBlockSchema` each gain `presentation: presentationSchema.optional(),` after their last existing field.

- [ ] **Step 4: Write `src/figures/layoutTimeline.ts`**

```ts
import type { Scene } from "./scene"

export interface TimelineEventSpec {
  when: string
  what: string
}

export interface TimelineLayoutResult {
  scene: Scene
  warnings: string[]
}

const PAD = 20
const SPINE_Y = 90
const H = 180
const STEM = 36
const MIN_EVENT_WIDTH = 90

/** Ordinal spacing: `when` is an arbitrary string, so events are evenly spaced,
 *  not scaled — the IR carries no dates and no coordinates (spec §Decisions). */
export function layoutTimeline(events: TimelineEventSpec[]): TimelineLayoutResult {
  const width = Math.max(460, PAD * 2 + events.length * MIN_EVENT_WIDTH)
  const step = (width - PAD * 2) / events.length
  const elements: Scene["elements"] = [
    { kind: "axis", x1: PAD, y1: SPINE_Y, x2: width - PAD, y2: SPINE_Y },
  ]
  events.forEach((e, i) => {
    const x = PAD + (i + 0.5) * step
    elements.push({ kind: "dot", x, y: SPINE_Y })
    const up = i % 2 === 0
    const endY = up ? SPINE_Y - STEM : SPINE_Y + STEM
    elements.push({ kind: "line-path", d: `M ${x} ${SPINE_Y} L ${x} ${endY}` })
    if (up) {
      elements.push({ kind: "label", x, y: endY - 18, text: e.what, anchor: "middle" })
      elements.push({ kind: "label", x, y: endY - 4, text: e.when, anchor: "middle", emphasis: true })
    } else {
      elements.push({ kind: "label", x, y: endY + 14, text: e.when, anchor: "middle", emphasis: true })
      elements.push({ kind: "label", x, y: endY + 28, text: e.what, anchor: "middle" })
    }
  })
  return { scene: { width, height: H, elements }, warnings: [] }
}
```

- [ ] **Step 5: Rewrite the three primitives with presentation branches**

`src/primitives/cause-effect.ts` — full replacement:

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { causeEffectBlockSchema, type CauseEffectBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import { layoutFlow, type FlowSpec } from "../figures/layoutFlow"
import { sceneToSvg } from "../figures/svg"

const CAUSE_EFFECT_FIGURE_MAX = 5

function resolvePresentation(block: CauseEffectBlock): "text" | "figure" {
  if (block.presentation === "text") return "text"
  if (block.presentation === "figure") return "figure"
  return block.chain.length <= CAUSE_EFFECT_FIGURE_MAX ? "figure" : "text" // auto
}

function renderTextForm(block: CauseEffectBlock): string {
  const items = block.chain
    .map(
      c =>
        `<li class="exp-cause-item">` +
        `<p class="exp-cause"><span class="exp-label">Because</span> ${renderInline(c.because)}</p>` +
        `<p class="exp-effect"><span class="exp-label">Therefore</span> ${renderInline(c.therefore)}</p>` +
        `</li>`,
    )
    .join("")
  return `<div class="exp-block exp-cause-effect"><ol class="exp-cause-chain">${items}</ol></div>`
}

function renderFigureForm(block: CauseEffectBlock): string {
  const spec: FlowSpec = {
    nodes: block.chain.flatMap((c, i) => [
      { id: `b${i}`, label: c.because, shape: "pill" as const },
      { id: `t${i}`, label: c.therefore, shape: "pill" as const },
    ]),
    edges: block.chain.map((_, i) => ({ from: `b${i}`, to: `t${i}`, kind: "causes" as const })),
    direction: "lr",
  }
  const { scene } = layoutFlow(spec)
  const aria = `Cause and effect: ${block.chain.map(c => `${c.because} → ${c.therefore}`).join("; ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria })
  return `<div class="exp-block exp-cause-effect exp-cause-effect-figure">${svg}</div>`
}

export function renderCauseEffect(block: CauseEffectBlock, _ctx: RenderContext): string {
  if (resolvePresentation(block) === "figure") return renderFigureForm(block)
  return renderTextForm(block)
}

registerPrimitive("cause-effect", { schema: causeEffectBlockSchema, render: renderCauseEffect })
```

`src/primitives/timeline.ts` — full replacement:

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { timelineBlockSchema, type TimelineBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import { layoutTimeline } from "../figures/layoutTimeline"
import { sceneToSvg } from "../figures/svg"

const TIMELINE_FIGURE_MAX = 12

function resolvePresentation(block: TimelineBlock): "text" | "figure" {
  if (block.presentation === "text") return "text"
  if (block.presentation === "figure") return "figure"
  return block.events.length <= TIMELINE_FIGURE_MAX ? "figure" : "text" // auto
}

function renderTextForm(block: TimelineBlock): string {
  const events = block.events
    .map(
      e =>
        `<li class="exp-event">` +
        `<span class="exp-event-when">${renderInline(e.when)}</span>` +
        `<p class="exp-event-what">${renderInline(e.what)}</p>` +
        (e.detail ? `<p class="exp-event-detail">${renderInline(e.detail)}</p>` : "") +
        `</li>`,
    )
    .join("")
  return `<div class="exp-block exp-timeline"><ol class="exp-timeline-events">${events}</ol></div>`
}

export function renderTimeline(block: TimelineBlock, _ctx: RenderContext): string {
  if (resolvePresentation(block) === "text") return renderTextForm(block)
  const { scene } = layoutTimeline(block.events.map(e => ({ when: e.when, what: e.what })))
  // `detail` is prose too long for figure labels; the text form carries it (spec §1).
  const aria = `Timeline: ${block.events.map(e => `${e.when} ${e.what}`).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria })
  return `<div class="exp-block exp-timeline exp-timeline-figure">${svg}</div>`
}

registerPrimitive("timeline", { schema: timelineBlockSchema, render: renderTimeline })
```

`src/primitives/data-callout.ts` — full replacement:

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { dataCalloutBlockSchema, type DataCalloutBlock } from "../core/schema"
import { escapeHtml, renderInline } from "../core/inline"
import { layoutSparkline } from "../figures/layoutChart"
import { sceneToSvg } from "../figures/svg"
import type { Scene } from "../figures/scene"

export function renderDataCallout(block: DataCalloutBlock, _ctx: RenderContext): string {
  const spark = resolveSparkline(block)
  const sparkSvg = spark ? sceneToSvg(spark.scene, { ariaLabel: spark.aria }) : ""
  const delta = block.delta
    ? `<span class="exp-delta${block.trend ? ` exp-delta-${block.trend}` : ""}">${escapeHtml(block.delta)}</span>`
    : ""
  const context = block.context ? `<p class="exp-context">${renderInline(block.context)}</p>` : ""
  return (
    `<div class="exp-block exp-data-callout">` +
    `<span class="exp-metric">${escapeHtml(block.metric)}</span>` +
    `<span class="exp-metric-label">${renderInline(block.label)}</span>` +
    delta +
    (sparkSvg ? `<div class="exp-spark-box">${sparkSvg}</div>` : "") +
    context +
    `</div>`
  )
}

/** Figure form = the callout markup plus a trend sparkline. No usable series
 *  (or presentation "text") → null → text markup (spec §1 leniency). */
function resolveSparkline(block: DataCalloutBlock): { scene: Scene; aria: string } | null {
  const wantsFigure = block.presentation !== "text"
  if (!wantsFigure) return null
  if (!block.series || block.series.length < 2) return null
  const { d, trend } = layoutSparkline(block.series)
  const scene: Scene = { width: 84, height: 28, elements: [{ kind: "sparkline", d, trend }] }
  return { scene, aria: `${block.metric} ${block.label} trend ${block.trend ?? "flat"}` }
}

registerPrimitive("data-callout", { schema: dataCalloutBlockSchema, render: renderDataCallout })
```

- [ ] **Step 6: Update `src/core/llm.ts`**

Append to the rules section of `systemPromptSnippet` (after the comparison rule):

```
- cause-effect/timeline/data-callout accept presentation?: "auto"|"text"|"figure". Default auto draws a figure when the data fits (cause-effect ≤5 links, timeline ≤12 events, data-callout with a series). Leave it as auto unless asked otherwise.
```

And extend the data-callout line to:

```
- data-callout: { metric, label, delta?, trend?: "up"|"down"|"flat", series?: number[] (2-24 samples for the trend sparkline), context? } — one number that matters.
```

- [ ] **Step 7: Pin the legacy markup in the two existing test files**

`tests/concept-cause-derivation.test.ts` — the cause-effect test's block gains `presentation: "text"` (the default is now a figure):

```ts
        { type: "cause-effect", chain: [{ because: "load doubled", therefore: "latency rose" }], presentation: "text" },
```

`tests/comparison-timeline.test.ts` — the timeline test's block gains `presentation: "text"`:

```ts
        { type: "timeline", events: [{ when: "1928", what: "Penicillin", detail: "Fleming" }], presentation: "text" },
```

(`tests/callouts.test.ts` needs no change: no `series` → text markup, byte-identical.)

- [ ] **Step 8: Run everything and commit**

Run: `npm test && npm run typecheck`
Expected: all PASS.

```bash
git add src/core/schema.ts src/core/llm.ts src/figures/layoutTimeline.ts src/primitives/cause-effect.ts src/primitives/timeline.ts src/primitives/data-callout.ts tests/presentation.test.ts tests/figures/layout-timeline.test.ts tests/concept-cause-derivation.test.ts tests/comparison-timeline.test.ts
git commit -m "feat(presentation): figure forms for cause-effect, timeline, data-callout"
```

---

### Task 6: Sketch pass (roughjs) + `sketch` plumbing

**Files:**
- Modify: `package.json` (add `roughjs` dependency)
- Create: `src/figures/seed.ts`, `src/figures/sketch.ts`
- Modify: `src/figures/svg.ts` (sketch branch in `sceneToSvg`)
- Modify: `src/core/registry.ts` (`RenderContext.sketch`), `src/core/render.ts` (`RenderOptions.sketch`, threading), `src/react/Explanation.tsx` (`sketch` prop)
- Modify: all five figure-rendering call sites to pass `sketch: ctx.sketch`
- Test: `tests/figures/sketch.test.ts`, `tests/sketch-render.test.ts`

**Interfaces:**
- Consumes: `rough.generator()` → `RoughGenerator`; `generator.toPaths(drawable)` → `PathInfo[] { d, stroke, strokeWidth, fill }` (SSR-safe; no DOM). Verified: the RoughGenerator wiki documents `toPaths(drawable)` returning path info with `d`/`stroke`/`strokeWidth`/`fill`.
- Produces: `hashSeed(s: string): string` (FNV-1a, base36); `seedNumber(hash: string, salt: number): number`; `sketchElementSvg(el: SceneElement, seed: string, index: number): string`; `RenderOptions.sketch?: boolean`; `RenderContext.sketch: boolean`; `renderBlock(type, data, depth?, opts?: { sketch?: boolean })`; `ExplanationProps.sketch?: boolean`.

- [ ] **Step 1: Install roughjs and verify the SSR-safe API**

```bash
npm install roughjs
```

Expected: added to `dependencies` in `package.json`. Verify the generator API exists:

```bash
node -e "const rough = require('roughjs'); const g = rough.generator(); const d = g.rectangle(0,0,10,10); console.log(JSON.stringify(g.toPaths(d)).slice(0,120))"
```

Expected output includes `"d":"M -2..."` style path data (paths slightly overshoot the box — that's the sketch wobble).

- [ ] **Step 2: Write the failing tests**

```ts
// tests/figures/sketch.test.ts
import { describe, expect, it } from "vitest"
import { hashSeed } from "../../src/figures/seed"
import { sketchElementSvg } from "../../src/figures/sketch"

describe("hashSeed", () => {
  it("is deterministic and input-sensitive", () => {
    expect(hashSeed("diagram:1")).toBe(hashSeed("diagram:1"))
    expect(hashSeed("a")).not.toBe(hashSeed("b"))
  })
})

describe("sketchElementSvg", () => {
  it("renders a node box as rough paths with token colors", () => {
    const svg = sketchElementSvg(
      { kind: "node-box", id: "a", x: 10, y: 10, w: 90, h: 44, shape: "box", label: "Hi" },
      "seed1",
      0,
    )
    expect(svg).toContain(`class="exp-fig-sketch"`)
    expect(svg).toContain(`var(--exp-node-fill)`)
    expect(svg).toContain(`var(--exp-node-stroke)`)
    expect(svg).toContain(`style="--draw-i:0"`)
  })

  it("same seed → byte-identical; different seed → different wobble", () => {
    const el = { kind: "node-box" as const, id: "a", x: 0, y: 0, w: 90, h: 44, shape: "box" as const, label: "Hi" }
    expect(sketchElementSvg(el, "s", 0)).toBe(sketchElementSvg(el, "s", 0))
    expect(sketchElementSvg(el, "s", 0)).not.toBe(sketchElementSvg(el, "t", 0))
  })

  it("keeps text labels crisp (not roughed)", () => {
    const svg = sketchElementSvg(
      { kind: "node-box", id: "a", x: 0, y: 0, w: 90, h: 44, shape: "box", label: "Hi" },
      "s",
      0,
    )
    expect(svg).not.toContain("Hi") // labels are emitted by the clean/sketch label path, not the rough pass
  })
})
```

```ts
// tests/sketch-render.test.ts
import { describe, expect, it } from "vitest"
import { renderBlock, renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

const ir = {
  version: 1,
  blocks: [
    {
      type: "diagram",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b" }],
    },
  ],
}

describe("sketch option", () => {
  it("default render is clean; sketch render adds exp-sketch and rough paths", () => {
    const clean = renderExplanation(ir)
    expect(clean.html).not.toContain(`exp-sketch`)
    expect(clean.html).not.toContain(`exp-fig-sketch`)

    const sketchy = renderExplanation(ir, { sketch: true })
    expect(sketchy.html).toContain(`class="exp exp-sketch"`)
    expect(sketchy.html).toContain(`class="exp-fig-sketch"`)
  })

  it("is byte-identical across runs (seeded)", () => {
    expect(renderExplanation(ir, { sketch: true }).html).toBe(renderExplanation(ir, { sketch: true }).html)
  })

  it("renderBlock accepts a sketch opt for the React adapter", () => {
    const html = renderBlock("diagram", ir.blocks[0], 1, { sketch: true })
    expect(html).toContain(`class="exp-fig-sketch"`)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/figures/sketch.test.ts tests/sketch-render.test.ts`
Expected: FAIL — modules/option missing.

- [ ] **Step 4: Write `src/figures/seed.ts`**

```ts
/** FNV-1a 32-bit, base36 — deterministic content-hash for sketch seeds. */
export function hashSeed(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** rough.js seed must be a uint32; derive it from a base36 hash string. */
export function seedNumber(hash: string, salt: number): number {
  return Number.parseInt(hashSeed(`${hash}:${salt}`), 36) % 0xffffffff
}
```

- [ ] **Step 5: Write `src/figures/sketch.ts`**

```ts
import rough from "roughjs"
import { seedNumber } from "./seed"
import type { SceneElement } from "./scene"

const ROUGH_BASE = { roughness: 1, bowing: 1, fillStyle: "solid" } as const

type RoughGenerator = ReturnType<typeof rough.generator>
type Drawable = ReturnType<RoughGenerator["rectangle"]>

function drawablesFor(gen: RoughGenerator, el: SceneElement, seed: string, index: number): Drawable[] {
  const opt = { ...ROUGH_BASE, seed: seedNumber(seed, index) }
  switch (el.kind) {
    case "node-box":
      return [
        gen.rectangle(el.x, el.y, el.w, el.h, {
          ...opt,
          fill: "var(--exp-node-fill)",
          stroke: "var(--exp-node-stroke)",
        }),
      ]
    case "arrow": {
      const edgeOpt =
        el.edgeKind === "conflict"
          ? { ...opt, stroke: "var(--exp-warning)", strokeLineDash: [5, 4] }
          : el.edgeKind === "part-of"
            ? { ...opt, stroke: "var(--exp-text-muted)", strokeLineDash: [2, 3] }
            : { ...opt, stroke: "var(--exp-ink)" }
      return [gen.path(el.d, edgeOpt), gen.path(el.head, edgeOpt)]
    }
    case "axis":
      return [gen.line(el.x1, el.y1, el.x2, el.y2, { ...opt, stroke: "var(--exp-edge)" })]
    case "bar":
      return [
        gen.rectangle(el.x, el.y, el.w, el.h, { ...opt, fill: "var(--exp-accent)", stroke: "var(--exp-accent)" }),
      ]
    case "line-path":
      return [gen.path(el.d, { ...opt, stroke: "var(--exp-accent)", strokeWidth: 2 })]
    case "dot":
      return [gen.circle(el.x, el.y, 8, { ...opt, fill: "var(--exp-accent)", stroke: "var(--exp-accent)" })]
    case "sparkline": {
      const stroke =
        el.trend === "up" ? "var(--exp-up)" : el.trend === "down" ? "var(--exp-down)" : "var(--exp-flat)"
      return [gen.path(el.d, { ...opt, stroke, strokeWidth: 2 })]
    }
    default:
      return [] // labels are never roughed
  }
}

/** Rough.js hand-drawn paths for one scene element. Labels are intentionally
 *  NOT roughed — text stays crisp; only strokes wobble. */
export function sketchElementSvg(el: SceneElement, seed: string, index: number): string {
  if (el.kind === "label") return ""
  const gen = rough.generator()
  const drawables = drawablesFor(gen, el, seed, index)
  return drawables
    .flatMap(d => gen.toPaths(d))
    .map(
      p =>
        `<path class="exp-fig-sketch" d="${p.d}" stroke="${p.stroke ?? "none"}" stroke-width="${p.strokeWidth ?? 1}" ` +
        `fill="${p.fill ?? "none"}" style="--draw-i:${index}"/>`,
    )
    .join("")
}
```

(If `import rough from "roughjs"` fails to typecheck under this repo's module settings, switch to `import * as rough from "roughjs"` — the runtime API is identical.)

- [ ] **Step 6: Add the sketch branch to `src/figures/svg.ts`**

Add the import and a `nodeLabel` helper, then replace `sceneToSvg`:

```ts
import { sketchElementSvg } from "./sketch"

function nodeLabel(el: NodeBoxEl): string {
  return (
    `<text x="${n2(el.x + el.w / 2)}" y="${n2(el.y + el.h / 2)}" text-anchor="middle" dominant-baseline="central" ` +
    `class="exp-node-label">${escapeHtml(el.label)}</text>`
  )
}
```

Refactor `nodeBox` to use `nodeLabel(el)` (no behavior change), then:

```ts
export function sceneToSvg(scene: Scene, opts: SceneSvgOptions): string {
  const body = opts.sketch
    ? scene.elements
        .map((el, i) => {
          const roughPart = sketchElementSvg(el, opts.seed ?? "", i)
          const labelPart =
            el.kind === "node-box" ? nodeLabel(el) : el.kind === "label" ? label(el, i) : ""
          return roughPart + labelPart
        })
        .join("")
    : scene.elements.map(cleanElement).join("")
  return (
    `<svg class="exp-figure" viewBox="0 0 ${n2(scene.width)} ${n2(scene.height)}" role="img" ` +
    `aria-label="${escapeHtml(opts.ariaLabel)}" xmlns="http://www.w3.org/2000/svg">` +
    `<title>${escapeHtml(opts.ariaLabel)}</title>` +
    body +
    `</svg>`
  )
}
```

- [ ] **Step 7: Thread the option through render + React**

`src/core/registry.ts` — `RenderContext` gains:

```ts
export interface RenderContext {
  depth: number
  /** Sketch pass on (exp-sketch): primitives render rough.js strokes. */
  sketch: boolean
  addWarning(message: string): void
  /** Leniently renders child blocks (used by stack); depth defaults to ctx.depth + 1. */
  renderChildren(blocks: unknown[], depth?: number): string
}
```

`src/core/render.ts`:

```ts
export interface RenderOptions {
  strict?: boolean
  theme?: "light" | "dark" | "none"
  /** Hand-drawn (rough.js) stroke pass on every figure. */
  sketch?: boolean
  root?: boolean
}
```

Root class line becomes:

```ts
  return { html: `<div class="exp${themeClass}${opts.sketch ? " exp-sketch" : ""}">${inner}</div>`, warnings }
```

Thread through the three private helpers — signatures become `renderSalvagedBlock(b, depth, warnings, sketch)` and `renderChildrenLenient(children, depth, warnings, sketch)`, with `const ctx: RenderContext = { depth, sketch, addWarning: …, renderChildren: … }` and the child call passing `sketch` along. `renderBlock` becomes:

```ts
export function renderBlock(type: string, data: unknown, depth = 1, opts: { sketch?: boolean } = {}): string {
  const raw = typeof data === "object" && data !== null ? { ...(data as object), type } : { type }
  const diagnostics: Diagnostic[] = []
  const b = salvageBlock(raw, -1, diagnostics)
  return renderSalvagedBlock(b, depth, [], opts.sketch ?? false)
}
```

`src/react/Explanation.tsx` — `ExplanationProps` gains `sketch?: boolean`; destructure it; root class:

```tsx
    <div className={themeClassName(theme) + (sketch ? " exp-sketch" : "")}>
```

and the fallback render call becomes:

```tsx
        return <div key={b.index} dangerouslySetInnerHTML={{ __html: renderBlock(b.type, b.data, 1, { sketch }) }} />
```

- [ ] **Step 8: Pass `sketch` + `seed` at the five figure call sites**

In `src/primitives/diagram.ts`, `src/primitives/chart.ts`, `cause-effect.ts` (figure form), `timeline.ts`, and `data-callout.ts` — change each `sceneToSvg(scene, { ariaLabel: aria })` to:

```ts
  const svg = sceneToSvg(scene, { ariaLabel: aria, sketch: ctx.sketch, seed: block.id ?? hashSeed(aria) })
```

adding to each file's imports:

```ts
import { hashSeed } from "../figures/seed"
```

For `diagram`, `cause-effect`, `timeline` this means renaming the `_ctx` parameter to `ctx`. For `data-callout`, `resolveSparkline` needs the flag: change its signature to `resolveSparkline(block, sketch: boolean)`, pass `sketch` and `seed: block.id ?? hashSeed(aria)` into its `sceneToSvg` call, and have `renderDataCallout` call `resolveSparkline(block, ctx.sketch)` (rename `_ctx` → `ctx`).

- [ ] **Step 9: Run everything and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS; build succeeds (roughjs bundles into `dist/index.js`).

```bash
git add package.json package-lock.json src/figures/seed.ts src/figures/sketch.ts src/figures/svg.ts src/core/registry.ts src/core/render.ts src/react/Explanation.tsx src/primitives/diagram.ts src/primitives/chart.ts src/primitives/cause-effect.ts src/primitives/timeline.ts src/primitives/data-callout.ts tests/figures/sketch.test.ts tests/sketch-render.test.ts
git commit -m "feat(sketch): rough.js hand-drawn pass with seeded determinism"
```

---

### Task 7: Demo fixture, server sections, and llm snippet closeout

**Files:**
- Modify: `demo/examples.js` (add `figuresIr`)
- Modify: `demo/server.mjs` (two new sections + section() sketch support)
- Modify: `tests/demo-examples.test.ts` (fixture validity + coverage)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–6 via the built `dist/`.
- Produces: a third demo explanation exercising `diagram`, `chart`, and a `cause-effect` figure form, plus a sketch-styled copy rendered with `sketch: true`.

- [ ] **Step 1: Add `figuresIr` to `demo/examples.js`**

```js
// Drawing-layer showcase — every figure rendered from semantic specs only.
export const figuresIr = {
  version: 1,
  title: "How a slow deploy gets rolled back",
  summary: "Diagrams and charts straight from the model — no coordinates anywhere.",
  blocks: [
    {
      type: "diagram",
      nodes: [
        { id: "dep", label: "Deploy ships", shape: "pill" },
        { id: "lat", label: "p95 latency spikes" },
        { id: "err", label: "Error rate climbs", shape: "note" },
        { id: "alert", label: "Alert fires", shape: "round" },
        { id: "rb", label: "Canary rollback", shape: "round" },
      ],
      edges: [
        { from: "dep", to: "lat", kind: "causes" },
        { from: "lat", to: "err", kind: "causes" },
        { from: "err", to: "alert", kind: "leads" },
        { from: "dep", to: "rb", label: "canary only" },
        { from: "dep", to: "err", label: "risk", kind: "conflict" },
      ],
      direction: "lr",
    },
    {
      type: "chart",
      kind: "bar",
      points: [
        { label: "Mon", value: 120 },
        { label: "Tue", value: 118 },
        { label: "Wed", value: 240 },
        { label: "Thu", value: 95 },
        { label: "Fri", value: 90 },
      ],
      unit: "ms",
      caption: "p95 latency by day",
    },
    {
      type: "cause-effect",
      presentation: "figure",
      chain: [
        { because: "Cache warmed at boot", therefore: "First requests stay fast." },
        { because: "Circuit breaker opens", therefore: "Retries back off instead of stampeding." },
      ],
    },
    {
      type: "callout",
      variant: "tip",
      body: "The renderer owns all geometry — the model only names nodes, edges, and values.",
    },
  ],
}
```

- [ ] **Step 2: Wire the sections into `demo/server.mjs`**

Update the import line:

```js
import { educationIr, dataIr, capabilitiesIr, figuresIr } from "./examples.js"
```

Extend `section()` to accept a sketch flag (the rough strokes come from the render option; the `exp-sketch` class is only cosmetic on a root:false wrapper):

```js
function section(id, theme, ir, extraClass = "", sketch = false) {
  const { html } = renderExplanation(ir, { theme: "none", root: false, sketch })
  return `<section id="${id}" class="exp exp-theme-${theme}${extraClass ? ` ${extraClass}` : ""}${sketch ? " exp-sketch" : ""}">${html}</section>`
}
```

Insert before the closing `<script>` (after the capabilities sections):

```
<h2>Figures</h2>
<p>LLM-emitted diagram and chart blocks, a cause-effect chain drawn as an arrow figure — the same IR twice: clean strokes, then the rough.js sketch pass.</p>
${section("figures", "light", figuresIr)}
${section("figures-sketch", "dark", figuresIr, "", true)}
```

(The second copy demonstrates both the sketch pass and the dark theme in one shot.)

- [ ] **Step 3: Extend `tests/demo-examples.test.ts`**

Update the imports:

```ts
import { educationIr, dataIr, capabilitiesIr, figuresIr } from "../demo/examples.js"
```

Add tests inside `describe("demo examples")`:

```ts
  it("figures fixture is schema-valid", () => {
    expect(explanationSchema.safeParse(figuresIr).success).toBe(true)
  })

  it("figures fixture covers diagram, chart, cause-effect, callout", () => {
    const types = collectTypes(figuresIr)
    for (const t of ["diagram", "chart", "cause-effect", "callout"]) {
      expect(types.has(t)).toBe(true)
    }
  })
```

- [ ] **Step 4: Run and commit**

Run: `npm run build && npm test`
Expected: PASS.

```bash
git add demo/examples.js demo/server.mjs tests/demo-examples.test.ts
git commit -m "feat(demo): figures showcase with sketch-mode copy"
```

---

### Task 8: Final verification

**Files:** none created — verification only.

**Interfaces:** Consumes the complete build.

- [ ] **Step 1: Full verification suite**

```bash
npm test && npm run typecheck && npm run build
```

Expected: all tests pass (baseline 59 + new tests), typecheck clean, build emits `dist/`.

- [ ] **Step 2: Manual demo check (visual acceptance)**

```bash
npm run demo
```

Open `http://localhost:4173` and verify visually:
- Figures section: diagram shows 5 nodes layered left-to-right with arrows (one dashed red conflict edge labeled "risk", one plain edge labeled "canary only"); bar chart has 5 accent bars with `ms` value labels; cause-effect renders as two pill-pairs with arrows.
- Figures-sketch copy: same figures in dark theme with wobbly strokes.
- Theme toggle still re-skins everything (figure SVGs included) without re-render.
- Progressive draw: in DevTools console run `document.querySelector('#figures').classList.add('exp-draw')` — strokes animate in sequence.

- [ ] **Step 3: Final commit (if anything was touched)**

```bash
git status --short
```

If clean: done. If the manual check forced CSS tweaks:

```bash
git add src/themes/
git commit -m "fix(themes): figure polish from visual pass"
```

---

## Self-review notes (resolved during writing)

- **Ordering hazard removed:** Figure CSS (Task 2) lands before any primitive emits markup, so every full-suite run passes `themes.test.ts` class coverage. All classes the suite can see are defined there: `exp-arrow`, `exp-node-box|round|pill|note`, `exp-cause_effect-figure` variants, `exp-fig-caption`, `exp-spark-box` included.
- **Type consistency:** `ArrowEl.labelX/labelY` are optional in the interface (Task 1) and always provided by `layoutFlow` for labeled edges (Task 3); the serializer only renders the label when both exist. `layoutSparkline` lives in `layoutChart.ts` (Task 4) and is consumed by `data-callout` (Task 5). `RenderContext.sketch` (Task 6) is consumed by all five figure call sites in the same task.
- **Spec coverage:** §1 IR contract → Tasks 3, 4, 5 (presentation + diagram + chart + series amendment). §2 figure system → Tasks 1, 3, 4, 5 (scenes/layouts), 6 (sketch + seed), 2 (exp-draw CSS, Phase 2). §3 integration → Task 6 (options/registry), Tasks 3/4/5 (llm snippet), Task 2 (themes), Task 7 (demo). A11y assertions → Tasks 1, 3, 4, 5. Determinism assertions → Tasks 1, 4, 6. Leniency assertions → Tasks 3, 4, 5.
- **Known intentional behavior:** default (`auto`) rendering of short cause-effect chains and timelines changes existing output (text → figure); the spec accepts this and Task 5 pins the legacy markup behind `presentation: "text"` in existing tests.
