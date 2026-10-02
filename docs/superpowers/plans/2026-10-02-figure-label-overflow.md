# Figure Label Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo executes plans **inline** — no CLI subagents (AGENTS.md).

**Goal:** Stop diagram edge labels and chart value labels from overlapping and
clipping, by measuring label text in the layouts the way node labels are
already measured.

**Architecture:** Two independent layout fixes plus one emit-layer change. The
diagram fix teaches `ArrowEl` the same pre-wrapped `lines` that `NodeBoxEl`
already carries, and wraps each edge label to the gutter it is routed through —
which is what structurally guarantees it cannot reach a node box. The chart fix
stops concatenating the unit onto every value, prints the unit once on its own
row above the plot, and omits any value label too wide for its band. No new
dependencies; text width stays a deterministic character estimate, the same
technique `wrapLabel` already uses.

**Tech Stack:** TypeScript (ES2022, strict), zod, vitest (node env), tsup.

**Spec:** `docs/superpowers/specs/2026-10-02-figure-label-overflow-design.md`
(approved 2026-10-02).

## Global Constraints

- **Deterministic text measurement.** Character-width estimates only. No
  canvas, no `getComputedTextLength` (non-deterministic, unavailable at SSR).
- **Wrap, never drop, diagram labels.** A label that does not fit wraps to the
  gutter; it is never truncated, ellipsised, or omitted. Wrapping to the gutter
  width is what guarantees no node overlap — no separate collision pass.
- **Single-line diagram output is byte-identical.** A label that fits on one
  line must emit exactly today's markup: no `lines` field, same `<text>`.
- **Degrade, never overlap (charts).** A value label too wide for its band is
  omitted; the bar, the unit row and the hover tip still convey the value.
- **One change per commit**, each independently green.
- **No new dependencies.** The repo's binding decision; hand-rolled estimates
  only.
- **Verification:** `npm run typecheck`, `npm test`, `npm run build`. Baseline
  at branch start: **373 tests / 44 files, all green**.
- **Branch:** `fix/figure-label-overflow`, merged **before** the editorial
  showcase, which stays open until then (spec §6).
- **Ledger:** append a line to `.superpowers/sdd/progress.md` per task
  (git-ignored — never `git add .superpowers`).

---

### Task 1: Diagram edge labels wrap to the gutter

**Files:**
- Modify: `src/figures/scene.ts` (`ArrowEl`)
- Modify: `src/figures/layoutFlow.ts`
- Modify: `src/figures/svg.ts` (`arrow()`)
- Test: `tests/figures/layout-flow.test.ts`

**Interfaces:**
- Consumes: existing `wrapLabel` (module-private), `NodeBoxEl.lines`, `ArrowEl`.
- Produces (used by Task 2 and the emit layer):
  - `ArrowEl.lines?: string[]` — pre-wrapped label lines, mirroring
    `NodeBoxEl.lines`. Absent or length 1 ⇒ single-line output as today.
  - `export function wrapEdgeLabel(label: string, avail: number): string[]` —
    wraps to `avail` px with no node padding, hard-splitting any single word
    wider than `avail` (so nothing can overflow).
  - `EDGE_LABEL_PITCH = 15` — line pitch at the 11px `.exp-edge-label` size.
  - `EDGE_CHAR_W = 6.0` — per-character estimate at 11px.

- [ ] **Step 1: Write the failing tests**

Append to `tests/figures/layout-flow.test.ts`:

```ts
// 11px .exp-edge-label class: ~6.0px per character.
const EDGE_CHAR_W = 6.0
const edgeTextW = (s: string) => Math.round(s.length * EDGE_CHAR_W)

const overflowIr = {
  direction: "lr" as const,
  nodes: [
    { id: "sun", label: "Sun", shape: "round" as const },
    { id: "air", label: "Atmosphere", shape: "box" as const },
    { id: "eye", label: "Your eye", shape: "pill" as const },
  ],
  edges: [
    { from: "sun", to: "air", label: "slant path — up to 38× the vertical", kind: "leads" as const },
    { from: "air", to: "eye", label: "back-scattered light, blue mostly gone", kind: "leads" as const },
  ],
}

function mustArrow(scene: Scene, id: string) {
  const el = scene.elements.find(e => e.kind === "arrow" && e.id === id)
  if (!el || el.kind !== "arrow") throw new Error(`arrow "${id}" not found`)
  return el
}

describe("edge label overflow", () => {
  it("wraps every edge label line to the gutter between the nodes", () => {
    const { scene, warnings } = layoutFlow(overflowIr)
    expect(warnings).toEqual([])
    const nodes = overflowIr.nodes.map(n => mustNode(scene, n.id))
    const air = nodes[1]
    const gutter = air.x - (nodes[0].x + nodes[0].w)

    const arrow = mustArrow(scene, "sun->air")
    const lines = arrow.lines ?? [arrow.label!]
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(edgeTextW(line)).toBeLessThanOrEqual(gutter)
    }
  })

  it("keeps a wrapped label clear of every node box", () => {
    const { scene } = layoutFlow(overflowIr)
    for (const id of ["sun->air", "air->eye"]) {
      const arrow = mustArrow(scene, id)
      const lines = arrow.lines ?? [arrow.label!]
      const half = Math.max(...lines.map(edgeTextW)) / 2
      const left = arrow.labelX! - half
      const right = arrow.labelX! + half
      for (const el of scene.elements) {
        if (el.kind !== "node-box") continue
        expect(right).toBeLessThanOrEqual(el.x)
        expect(left).toBeGreaterThanOrEqual(el.x + el.w)
      }
    }
  })

  it("hard-splits a single word wider than the gutter", () => {
    const { scene } = layoutFlow({
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b", label: "extraordinarily" }],
      direction: "lr",
    })
    const arrow = mustArrow(scene, "a->b")
    const lines = arrow.lines ?? [arrow.label!]
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join("")).toBe("extraordinarily")
    const gutter = mustNode(scene, "b").x - (mustNode(scene, "a").x + mustNode(scene, "a").w)
    for (const line of lines) expect(edgeTextW(line)).toBeLessThanOrEqual(gutter)
  })

  it("leaves a short label single-line, with no lines field (byte-identical emit)", () => {
    const { scene } = layoutFlow({
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b", label: "hit" }],
      direction: "lr",
    })
    const arrow = mustArrow(scene, "a->b")
    expect(arrow.lines).toBeUndefined()
    expect(arrow.label).toBe("hit")
  })

  it("grows the scene so a tall wrapped label is not clipped", () => {
    const { scene } = layoutFlow(overflowIr)
    for (const el of scene.elements) {
      if (el.kind !== "arrow") continue
      const lines = el.lines ?? (el.label ? [el.label] : [])
      if (lines.length < 2) continue
      const blockH = ((lines.length - 1) * 15) / 2
      expect(el.labelY! + blockH).toBeLessThanOrEqual(scene.height)
      expect(el.labelY! - blockH).toBeGreaterThanOrEqual(0)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/figures/layout-flow.test.ts`

Expected: the 5 new tests FAIL (no `lines` field, labels unmeasured). The
existing flow tests stay green.

- [ ] **Step 3: Add `lines` to `ArrowEl`**

In `src/figures/scene.ts`, extend `ArrowEl`:

```ts
export interface ArrowEl {
  kind: "arrow"
  /** Shaft path; ends just short of the head tip. */
  d: string
  /** Closed triangle path for the arrowhead. */
  head: string
  label?: string
  /** Pre-wrapped label lines (layout-owned), mirroring NodeBoxEl.lines.
   *  Absent or single-entry ⇒ the emit layer writes one plain <text>. */
  lines?: string[]
  /** Label anchor point (computed by the layout, absolute scene coordinates).
   *  For a wrapped label this is the block's vertical CENTRE. */
  labelX?: number
  labelY?: number
  edgeKind: EdgeKind
  id?: string
  tip?: string
}
```

- [ ] **Step 4: Wrap edge labels in `layoutFlow`**

In `src/figures/layoutFlow.ts`, add beside the existing `CHAR_W`:

```ts
const EDGE_CHAR_W = 6.0 // per-char estimate at the 11px .exp-edge-label size
export const EDGE_LABEL_PITCH = 15 // line pitch at that size
```

and add the wrapper next to `wrapLabel`:

```ts
/** Wrap an EDGE label to the gutter it is routed through. Unlike
 *  `wrapLabel` there is no node padding to reserve, and any single word
 *  wider than the gutter is hard-split — an edge label is never dropped,
 *  so it must never overflow either (diagram label-overflow spec §3.1). */
export function wrapEdgeLabel(label: string, avail: number): string[] {
  const maxChars = Math.max(4, Math.floor(avail / EDGE_CHAR_W))
  const words = label.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current)
        current = ""
      }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars))
      continue
    }
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : [label]
}
```

Then, in the edge loop, replace the `elements.push({ kind: "arrow", … })` call.
Compute the available gutter width and the wrapped lines **before** building the
path, then emit `lines` and shift `labelY` by half the block height so the
block is centred on the edge:

```ts
  const elements: Scene["elements"] = []
  for (const e of edges) {
    const a = placed.get(e.from)!
    const b = placed.get(e.to)!
    // … existing path/head/labelX/labelY computation unchanged …

    // Available label width is the gutter this edge is routed through: for an
    // adjacent edge, the gap between the two boxes; for a skip-rank edge, the
    // same horizontal span the orthogonal route uses. Wrapping to it is what
    // guarantees the label cannot reach a node box (spec §2.2).
    const gutterW = Math.max(8, b.x - (a.x + a.w))
    const lines = e.label ? wrapEdgeLabel(e.label, gutterW) : []

    // labelY from the path maths is the position of the FIRST line; shift it
    // up by half the block so the block as a whole is centred on the edge.
    const shift = ((lines.length - 1) * EDGE_LABEL_PITCH) / 2

    elements.push({
      kind: "arrow",
      d,
      head,
      edgeKind: e.kind ?? "leads",
      label: e.label,
      ...(lines.length > 1 ? { lines } : {}),
      labelX,
      labelY: labelY - shift,
      id: `${e.from}->${e.to}`,
    })
  }
```

Finally, widen the scene so a tall wrapped block is never clipped. Just before
the `return` in `layoutFlow`:

```ts
  // Scene extent must contain every wrapped label block: a multi-line edge
  // label can reach past the node bounds it was laid out against.
  let minY = 0
  let maxY = height
  for (const el of elements) {
    if (el.kind !== "arrow" || el.labelY === undefined) continue
    const n = el.lines?.length ?? 1
    const half = ((n - 1) * EDGE_LABEL_PITCH) / 2 + n * 2
    minY = Math.min(minY, el.labelY - half)
    maxY = Math.max(maxY, el.labelY + half)
  }
  if (minY < 0 || maxY > height) {
    for (const el of elements) {
      if (el.kind !== "node-box") continue
      el.y -= minY
    }
    for (const el of elements) {
      if (el.kind !== "arrow" || el.labelY === undefined) continue
      el.labelY -= minY
    }
    height -= minY
  }
```

- [ ] **Step 5: Emit wrapped labels as tspans**

In `src/figures/svg.ts`, replace the `label` const inside `arrow()`:

```ts
function arrowLabel(el: ArrowEl): string {
  if (!el.label || el.labelX === undefined || el.labelY === undefined) return ""
  const open =
    `<text class="exp-fig-label exp-edge-label" text-anchor="middle" ` +
    `transform="translate(${n2(el.labelX)},${n2(el.labelY)})"`
  const lines = el.lines && el.lines.length > 0 ? el.lines : [el.label]
  // Single line: exactly the markup shipped before, so nothing downstream
  // churns (spec §2.6).
  if (lines.length === 1) return `${open}>${escapeHtml(lines[0])}</text>`
  // tspan coordinates resolve INSIDE the translated group, so they are local:
  // x stays 0 (text-anchor=middle centres on the translate point) and y is the
  // offset from the block centre. Baking labelX into the tspan x as well would
  // double-offset the block.
  const pitch = 15
  const tspans = lines
    .map((line, i) => {
      const y = -((lines.length - 1) * pitch) / 2 + i * pitch
      return `<tspan x="0" y="${n2(y)}">${escapeHtml(line)}</tspan>`
    })
    .join("")
  return `${open}>${tspans}</text>`
}
```

and in `arrow()`, replace the inline `label` expression with
`arrowLabel(el)`.

Because `labelY` is now the block centre (Task 1, Step 4), the tspans need no
further adjustment — the block is centred on the edge by construction.

- [ ] **Step 6: Verify tests, typecheck, and the full suite**

```bash
npx vitest run tests/figures/layout-flow.test.ts tests/figure.test.ts && npm run typecheck && npm test
```

Expected: all flow tests pass (5 new), figure tests unaffected, tsc clean,
**378/378** (373 + 5).

- [ ] **Step 7: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Figure-label Task 1: complete (<sha>; edge labels wrap to the gutter, single-line output unchanged; 378/378, tsc clean)`

```bash
git add src/figures/scene.ts src/figures/layoutFlow.ts src/figures/svg.ts tests/figures/layout-flow.test.ts
git commit -m "fix(figures): wrap diagram edge labels to the gutter they are routed through"
```

---

### Task 2: Chart value labels — bare values, unit once, no collisions

**Files:**
- Modify: `src/figures/scene.ts` (`BarEl.valueLabel` comment)
- Modify: `src/figures/layoutChart.ts`
- Test: `tests/figures/layout-chart.test.ts`

**Interfaces:**
- Consumes: existing `layoutChart`, `ChartSpec`.
- Produces: `fmtValue(v)` returns a bare number; the unit is emitted once as a
  `LabelEl` on its own row; value `LabelEl`s are omitted when wider than their
  band. `PAD_T` 16 → 40.

- [ ] **Step 1: Write the failing tests**

In `tests/figures/layout-chart.test.ts`, **replace** the first test's assertion
block (it pins the buggy concatenation) and append the new describe.

Replace:

```ts
    const texts = scene.elements.filter(e => e.kind === "label").map(e => (e as { text: string }).text)
    expect(texts).toContain("240ms")
    expect(texts).toContain("Tue")
```

with:

```ts
    const texts = scene.elements.filter(e => e.kind === "label").map(e => (e as { text: string }).text)
    // The unit is printed once for the whole plot, never glued onto every
    // value (figure-label-overflow spec §2.3).
    expect(texts).toContain("240")
    expect(texts).not.toContain("240ms")
    expect(texts.filter(t => t === "ms")).toHaveLength(1)
    expect(texts).toContain("Tue")
```

Then append:

```ts
// 11px .exp-fig-label-emphasis class at weight 650: ~6.6px per character.
const VALUE_CHAR_W = 6.6
const valueTextW = (s: string) => Math.round(s.length * VALUE_CHAR_W)

const spectralIr = {
  kind: "bar" as const,
  unit: "relative intensity",
  points: [
    { label: "400nm", value: 1 },
    { label: "450nm", value: 0.62 },
    { label: "500nm", value: 0.41 },
    { label: "550nm", value: 0.28 },
    { label: "600nm", value: 0.2 },
    { label: "650nm", value: 0.14 },
    { label: "700nm", value: 0.11 },
  ],
}

describe("chart value label overflow", () => {
  const emphasis = (scene: Scene) =>
    scene.elements.filter(e => e.kind === "label" && e.emphasis).map(e => e as { text: string; x: number; y: number })

  it("never glues the unit onto a value label", () => {
    const { scene } = layoutChart(spectralIr)
    for (const l of emphasis(scene)) expect(l.text).not.toContain("relative intensity")
  })

  it("prints the unit exactly once, on its own row above the plot", () => {
    const { scene } = layoutChart(spectralIr)
    const units = scene.elements.filter(
      e => e.kind === "label" && e.text === "relative intensity",
    ) as { y: number }[]
    expect(units).toHaveLength(1)
    // Clear of every value label's baseline, so a tall first bar cannot collide.
    const values = emphasis(scene)
    for (const v of values) expect(units[0].y).toBeLessThan(v.y - 6)
  })

  it("keeps every emitted value label inside its band", () => {
    const { scene } = layoutChart(spectralIr)
    const band = (scene.width - 34 - 12) / spectralIr.points.length
    for (const l of emphasis(scene)) {
      expect(valueTextW(l.text)).toBeLessThanOrEqual(band)
    }
  })

  it("keeps every value label inside the scene bounds", () => {
    const { scene } = layoutChart(spectralIr)
    for (const l of emphasis(scene)) {
      expect(l.x - valueTextW(l.text) / 2).toBeGreaterThanOrEqual(0)
      expect(l.x + valueTextW(l.text) / 2).toBeLessThanOrEqual(scene.width)
      expect(l.y).toBeGreaterThanOrEqual(0)
    }
  })

  it("omits a value label too wide for its band but keeps the bar", () => {
    const wide = Array.from({ length: 12 }, (_, i) => ({ label: `p${i}`, value: i === 0 ? 987654 : 1 }))
    const { scene } = layoutChart({ kind: "bar", points: wide })
    const texts = emphasis(scene).map(l => l.text)
    expect(texts).not.toContain("987654")
    expect(scene.elements.filter(e => e.kind === "bar")).toHaveLength(12)
  })
})
```

Add the type import at the top of the file if absent:

```ts
import type { Scene } from "../../src/figures/scene"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/figures/layout-chart.test.ts`

Expected: FAIL — the re-derived test wants bare values, the 4 new ones want no
unit concatenation, no collisions, no clipping.

- [ ] **Step 3: Implement in `layoutChart.ts`**

Replace the constants and `fmtValue`:

```ts
const PAD_T = 40 // room for the unit row plus the tallest mark's value label
const UNIT_LABEL_Y = 12
const BAND_TOLERANCE = 4
const VALUE_CHAR_W = 6.6 // per-char estimate at the 11px emphasis label size
```

```ts
/** Bare value text. The unit is emitted ONCE as its own label above the
 *  plot (spec §2.3) — appending it to every value overflowed the band and
 *  clipped at the scene edge. */
function fmtValue(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
}
```

In `layoutChart`, after `const yAt = …`, emit the unit once:

```ts
  // The unit, once, on a row of its own above the plot. Its own row is what
  // keeps it clear of the tallest mark's value label regardless of data order.
  if (spec.unit) {
    elements.push({ kind: "label", x: PAD_L, y: UNIT_LABEL_Y, text: spec.unit, anchor: "start" })
  }
```

Then replace the two `fmtValue(p.value, spec.unit)` call sites. Bar branch:

```ts
    points.forEach((p, i) => {
      const h = yAt(0) - yAt(p.value)
      const x = PAD_L + i * band + (band - bw) / 2
      const y = baseline - h
      const value = fmtValue(p.value)
      elements.push({ kind: "bar", x, y, w: bw, h, valueLabel: value, id: `bar:${p.label}`, tip: p.tip })
      // Degrade rather than overlap: a value too wide for its band is dropped,
      // leaving the bar height, the unit row and the tip to carry the value.
      if (value.length * VALUE_CHAR_W <= band - BAND_TOLERANCE) {
        elements.push({ kind: "label", x: x + bw / 2, y: y - 6, text: value, anchor: "middle", emphasis: true })
      }
      elements.push({ kind: "label", x: x + bw / 2, y: baseline + 16, text: p.label, anchor: "middle" })
    })
```

Line branch:

```ts
    points.forEach((p, i) => {
      const x = xAt(i, n)
      const y = yAt(p.value)
      const value = fmtValue(p.value)
      elements.push({ kind: "dot", x, y, id: `dot:${p.label}`, tip: p.tip })
      const seg = n === 1 ? W : plotW / (n - 1)
      if (value.length * VALUE_CHAR_W <= seg - BAND_TOLERANCE) {
        elements.push({ kind: "label", x, y: y - 8, text: value, anchor: "middle", emphasis: true })
      }
      elements.push({ kind: "label", x, y: baseline + 16, text: p.label, anchor: "middle" })
    })
```

- [ ] **Step 4: Update the `BarEl.valueLabel` contract comment**

In `src/figures/scene.ts`:

```ts
  /** Preformatted value text (no unit — the unit is one plot-level label).
   *  The layout emits the matching LabelEl when it fits the band. */
  valueLabel: string
```

- [ ] **Step 5: Verify and run the full suite**

```bash
npx vitest run tests/figures/layout-chart.test.ts tests/chart.test.ts && npm run typecheck && npm test
```

Expected: chart tests pass (4 new + the re-derived one), tsc clean,
**382/382** (378 + 4).

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Figure-label Task 2: complete (<sha>; bare values, unit once, oversized labels omitted; 382/382, tsc clean)`

```bash
git add src/figures/scene.ts src/figures/layoutChart.ts tests/figures/layout-chart.test.ts
git commit -m "fix(figures): chart values stay bare, unit printed once, oversized labels dropped"
```

---

### Task 3: Verification, DEBUGGING entry, demo re-check

**Files:**
- Modify: `docs/DEBUGGING.md`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: the dated lesson entry; a visually verified showcase.

- [ ] **Step 1: Full verification**

```bash
npm run typecheck && npm test && npm run build
```

Expected: tsc clean, **382/382**, build succeeds.

- [ ] **Step 2: Append the DEBUGGING entry**

Append to `docs/DEBUGGING.md` Part 2, following the file's existing
symptom → root cause → fix → rule shape:

```markdown
### 2026-10-02 — Figure labels overlap whatever they are centred in

**Symptom:** a diagram edge label was eclipsed by the node boxes beside it;
chart value labels collided with their neighbours and the last one clipped
past the SVG edge. Reported with screenshots from `/editorial`.

**Root cause:** two layouts placed label text at fixed coordinates without
measuring it. `layoutFlow` centred `labelX` on a fixed 64px gutter; a 231px
label overhung ~90px each side, and nodes (emitted after edges, opaque fill)
painted over it. `layoutChart.fmtValue` concatenated the unit onto every value
("0.62relative intensity") and placed labels with no check against the band.
Only node labels were ever measured — via `wrapLabel`, "layout-owned".

**Fix:** wrap edge labels to the gutter they are routed through (wrapping to
that width is what guarantees no node overlap — no collision pass needed);
print the chart unit once on its own row and omit any value label wider than
its band.

**Rule:** every piece of text a layout emits must be measured against the space
it will occupy, and the layouts — not the CSS — own fitting it. If a label can
be positioned but never sized, it is a bug waiting for longer content. Watch
for the same shape in figure labels, TOC entries and axis ticks. The test that
asserted the old `"240ms"` output was pinning the defect, not the contract.
```

- [ ] **Step 3: Restart the demo and confirm the fix on the real page**

```bash
launchctl remove explanations-demo 2>/dev/null; sleep 1
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
```

From a **separate** tool call:

```bash
for p in /editorial /; do printf "%s -> " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4173$p"; done
```

Then open http://localhost:4173/editorial and confirm: the diagram's edge
labels are wrapped and legible between the bubbles with nothing eclipsed; the
chart shows bare values with the unit once above the plot; nothing is clipped.

- [ ] **Step 4: Commit**

```bash
git add docs/DEBUGGING.md
git commit -m "docs: record the unmeasured-label lesson from the figure overflow fix"
```

---

## Branch finish

1. Re-verify the showcase against the fixed library (Task 3 Step 3) — this is
   the gate for merging `feature/editorial-showcase`.
2. Ledger: `Figure-label final review: …` + a `Branch finished` line.
3. Report to the user; merge `fix/figure-label-overflow` on go-ahead, then
   re-verify and merge the showcase.