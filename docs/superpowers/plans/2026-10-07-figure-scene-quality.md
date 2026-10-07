# Figure Scene Quality Implementation Plan

> **For agentic workers:** Execute **inline in-session** (AGENTS.md: no CLI
> subagents on this machine). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the renderer from silently losing authored-figure content
(clipping out-of-canvas elements, ignoring `label` on leaf shapes) and teach
the LLM contract the scene rules, so real-model figures come back readable.

**Architecture:** Three renderer changes in `src/figures/` — grow-to-content
viewBox in `svg.ts`, box-label wrapping (`authored.ts` + `svg.ts`), and
`label` sugar on leaf elements (`authored.ts` parse + compile) — then one
prompt-contract line in `BLOCK_TYPE_DOCS`, verified by re-running the
real-compile experiment and the CDP figure probe.

**Tech Stack:** TypeScript, vitest, no new dependencies. Corpus gate via
`.superpowers/render-fixtures.mjs`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-07-figure-scene-quality.md` (§ numbers
  below refer to it).
- **Byte-identical corpus:** every in-canvas demo figure must emit identical
  SVG. Gate: build, then `node .superpowers/render-fixtures.mjs dist out.txt`,
  `diff` against the main baseline (Task 1 Step 0). Run after every
  render-affecting task.
- **No new warnings for growth** (spec §3.1): warnings mean loss; a grown
  figure lost nothing.
- **No warnings for ignored fields** — element parsers read known fields only;
  warning on unknowns would break the documented compat contract
  (`tests/compat.test.ts`).
- TDD: every task watches its test fail first. One commit per task.
- Branch: `feature/figure-scene-quality` off `main` (spec commit 4691b67).
- Acceptance (spec §4.4): re-run `.superpowers/real-compile.mjs`, re-measure
  with `.superpowers/shoot-mrna-figures.mjs` — zero out-of-canvas elements,
  zero label×label overlaps in the two regenerated figures.

## Task 0: Branch + corpus baseline

**Files:** none created; baseline written to gitignored scratch.

- [ ] **Step 1: Branch off main**

```bash
git checkout -b feature/figure-scene-quality
```

- [ ] **Step 2: Build main and write the corpus baseline**

```bash
npm run build 2>&1 | tail -1
node .superpowers/render-fixtures.mjs dist .superpowers/corpus-main.txt
```

Expected: `wrote .superpowers/corpus-main.txt`. Keep this file; every task
diffs against it.

---

## Task 1: Grow-to-content viewBox (`svg.ts`)

**Files:**
- Modify: `src/figures/svg.ts` (viewBox emission in `sceneToSvg`, new helpers)
- Test: `tests/figures/svg.test.ts`

**Interfaces:**
- Consumes: `Scene` / `SceneElement` from `./scene` (existing).
- Produces: `sceneToSvg(scene, opts)` unchanged signature; emitted
  `viewBox`/`width`/`height` are the union of `0 0 scene.width scene.height`
  and the bounds of every `figure-*` element. Layout-driven element kinds
  (`node-box`, `arrow`, `label`, `bar`, `axis`, `line-path`, `dot`,
  `sparkline`) are **ignored** — their layouts already size scenes to fit, and
  estimating their text bounds could grow a demo scene and break the corpus
  gate.

- [ ] **Step 1: Write the failing tests** (append to `tests/figures/svg.test.ts`;
  reuse whatever scene-fixture helper the file already uses — if none, build
  `Scene` objects inline as below)

```ts
describe("sceneToSvg: grow-to-content viewBox", () => {
  const ARIA = { ariaLabel: "test" }

  it("grows the viewBox to contain an out-of-canvas figure-label", () => {
    const svg = sceneToSvg(
      {
        width: 360, height: 240,
        elements: [{ kind: "figure-label", x: 100, y: 250, text: "below the canvas", size: 11, anchor: "middle" }],
      },
      ARIA,
    )
    const vb = svg.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number)
    expect(vb[3]).toBeGreaterThanOrEqual(263) // 250 + ~13px of text
  })

  it("grows to negative bounds when content sits above/left of the canvas", () => {
    const svg = sceneToSvg(
      {
        width: 360, height: 240,
        elements: [{ kind: "figure-dot", cx: -10, cy: 20, r: 4, tone: "accent" }],
      },
      ARIA,
    )
    const vb = svg.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number)
    expect(vb[0]).toBeLessThanOrEqual(-14) // minX = cx - r
  })

  it("keeps the canvas floor: viewBox is never smaller than the scene", () => {
    const svg = sceneToSvg(
      {
        width: 360, height: 240,
        elements: [{ kind: "figure-dot", cx: 180, cy: 120, r: 3, tone: "accent" }],
      },
      ARIA,
    )
    expect(svg).toContain('width="360" height="240" viewBox="0 0 360 240"')
  })

  it("layout-driven elements never grow the scene (corpus safety)", () => {
    const svg = sceneToSvg(
      {
        width: 360, height: 240,
        elements: [{ kind: "label", x: 350, y: 230, text: "very long layout label here", anchor: "start" }],
      },
      ARIA,
    )
    expect(svg).toContain('viewBox="0 0 360 240"')
  })
})
```

- [ ] **Step 2: Run to verify RED**

```bash
npx vitest run tests/figures/svg.test.ts
```

Expected: 3 fail (grow not implemented), the layout-driven test may already
pass — that is fine, it is a guard.

- [ ] **Step 3: Implement in `src/figures/svg.ts`**

Add above `sceneToSvg`:

```ts
/** Grow-to-content bounds (figure scene quality spec §3.1). Only AUTHORED
 *  figure elements participate: layout-driven scenes are sized to fit by
 *  their layout passes, and estimating their text bounds could grow a demo
 *  scene. Estimates are deliberately generous — growth only adds margin, and
 *  under-estimating would leave content clipped, the defect this fixes. */
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

const LABEL_CHAR_W = 6.5 // per-char estimate at 11px, generous (measured ~5.7)

function elementBounds(el: SceneElement): Bounds | null {
  switch (el.kind) {
    case "figure-box":
      return { minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h }
    case "figure-dot":
      return { minX: el.cx - el.r, minY: el.cy - el.r, maxX: el.cx + el.r, maxY: el.cy + el.r }
    case "figure-line":
      return {
        minX: Math.min(el.x1, el.x2), minY: Math.min(el.y1, el.y2),
        maxX: Math.max(el.x1, el.x2), maxY: Math.max(el.y1, el.y2),
      }
    case "figure-path": {
      // Superset from every coordinate pair in d, control points included
      // (growth only adds margin; under-estimating would keep clipping).
      const nums = el.d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? []
      let b: Bounds | null = null
      for (let i = 0; i + 1 < nums.length; i += 2) {
        b = {
          minX: Math.min(b?.minX ?? nums[i]!, nums[i]!),
          minY: Math.min(b?.minY ?? nums[i + 1]!, nums[i + 1]!),
          maxX: Math.max(b?.maxX ?? nums[i]!, nums[i]!),
          maxY: Math.max(b?.maxY ?? nums[i + 1]!, nums[i + 1]!),
        }
      }
      return b
    }
    case "figure-label": {
      const w = el.text.length * (el.size / 11) * LABEL_CHAR_W
      const x = el.anchor === "middle" ? el.x - w / 2 : el.anchor === "end" ? el.x - w : el.x
      return { minX: x, minY: el.y - el.size, maxX: x + w, maxY: el.y + 3 }
    }
    default:
      return null
  }
}

function sceneBounds(scene: Scene): Bounds {
  const b: Bounds = { minX: 0, minY: 0, maxX: scene.width, maxY: scene.height }
  for (const el of scene.elements) {
    const eb = elementBounds(el)
    if (!eb) continue
    b.minX = Math.min(b.minX, eb.minX)
    b.minY = Math.min(b.minY, eb.minY)
    b.maxX = Math.max(b.maxX, eb.maxX)
    b.maxY = Math.max(b.maxY, eb.maxY)
  }
  return b
}
```

Then replace the `<svg>` open tag construction in `sceneToSvg`:

```ts
  const b = sceneBounds(scene)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  return (
    `<svg class="exp-figure" width="${n2(w)}" height="${n2(h)}" ` +
    `viewBox="${n2(b.minX)} ${n2(b.minY)} ${n2(w)} ${n2(h)}" role="img" ` +
    `aria-label="${escapeHtml(opts.ariaLabel)}" xmlns="http://www.w3.org/2000/svg">` +
```

(Keep the existing comments above the tag; for an in-canvas scene
`b` is exactly `{0, 0, scene.width, scene.height}`, so the emission is
byte-identical.)

- [ ] **Step 4: Run to verify GREEN**

```bash
npx vitest run tests/figures/svg.test.ts
```

Expected: PASS (all four).

- [ ] **Step 5: Corpus gate**

```bash
npm run build 2>&1 | tail -1
node .superpowers/render-fixtures.mjs dist .superpowers/corpus-task1.txt
diff .superpowers/corpus-main.txt .superpowers/corpus-task1.txt && echo BYTE-IDENTICAL
```

Expected: `BYTE-IDENTICAL`. **If a diff appears**, a demo label estimate pokes
out of the canvas: lower `LABEL_CHAR_W` toward 5.7 (the measured value) and
re-run. Record whatever constant survives the gate in the commit message.

- [ ] **Step 6: Full suite + commit**

```bash
npx vitest run 2>&1 | grep -E "Tests |failed" && npx tsc --noEmit && echo TSC-CLEAN
git add src/figures/svg.ts tests/figures/svg.test.ts
git commit -m "figures: grow the viewBox to contain out-of-canvas content"
```

---

## Task 2: Box labels wrap to the box width (`authored.ts` + `scene.ts` + `svg.ts`)

**Files:**
- Modify: `src/figures/authored.ts` (new `wrapBoxLabel`, used in `compileEl`'s `box` case)
- Modify: `src/figures/scene.ts:119-131` (`FigureBoxEl` gains `lines?: string[]`)
- Modify: `src/figures/svg.ts` (`figureBox` renders multi-line)
- Test: `tests/figures/authored.test.ts`, `tests/figures/svg.test.ts`

**Interfaces:**
- Produces: `FigureBoxEl { ..., label: string | null, lines?: string[] }`. When
  `lines` is absent or length ≤ 1, `figureBox` emits **exactly** today's
  single-line markup (corpus gate); when present, tspans at pitch 15, centered
  like `nodeLabel` (svg.ts:88-104).

- [ ] **Step 1: Failing tests** — in `tests/figures/authored.test.ts`

```ts
describe("figure box label wrapping", () => {
  it("wraps a long box label to the box width", () => {
    const { scene } = compileFigure({
      elements: [{ kind: "box", x: 50, y: 200, w: 100, h: 40, label: "Proteasome (degrades proteins)" }],
    })
    const box = scene.elements[0] as FigureBoxEl
    expect(box.lines).toBeDefined()
    expect(box.lines!.length).toBeGreaterThan(1)
    for (const line of box.lines!) expect(line.length).toBeLessThanOrEqual(Math.floor((100 - 16) / 7.5))
  })

  it("leaves a fitting label unwrapped (no lines field)", () => {
    const { scene } = compileFigure({
      elements: [{ kind: "box", x: 50, y: 30, w: 100, h: 40, label: "Infected Cell" }],
    })
    expect((scene.elements[0] as FigureBoxEl).lines).toBeUndefined()
  })
})
```

(Import `compileFigure` and `FigureBoxEl` the way the file already imports
them; if `compileFigure` is not yet imported there, add
`import { compileFigure } from "../../src/figures/authored"`.)

And in `tests/figures/svg.test.ts`:

```ts
it("renders a wrapped box label as centered tspans", () => {
  const svg = sceneToSvg(
    {
      width: 360, height: 240,
      elements: [{ kind: "figure-box", x: 50, y: 200, w: 100, h: 40, r: 4, label: "Proteasome (degrades proteins)", tone: "ink", fill: null, lines: ["Proteasome", "(degrades", "proteins)"] }],
    },
    ARIA,
  )
  expect(svg).toContain("<tspan")
  expect(svg).toContain("class=\"exp-fig-label\"")
})

it("keeps the single-line box label markup byte-identical", () => {
  const svg = sceneToSvg(
    {
      width: 360, height: 240,
      elements: [{ kind: "figure-box", x: 50, y: 30, w: 100, h: 40, r: 4, label: "Cell", tone: "ink", fill: null }],
    },
    ARIA,
  )
  expect(svg).toContain('<text x="100" y="50" text-anchor="middle" dominant-baseline="central" class="exp-fig-label">Cell</text>')
})
```

- [ ] **Step 2: RED** — `npx vitest run tests/figures/authored.test.ts tests/figures/svg.test.ts`
  Expected: wrapping tests fail (no `lines`, no tspans); byte-identical guard passes.

- [ ] **Step 3: Implement** — in `src/figures/authored.ts`, near the top (beside
  the other constants at lines 62-64):

```ts
const BOX_CHAR_W = 7.5 // per-char estimate at 13px — same basis as layoutFlow's wrapLabel

/** Wrap a box label to the box width (figure scene quality spec §3.3): word
 *  boundaries, 16px horizontal padding, never fewer than 6 chars per line. */
function wrapBoxLabel(label: string, w: number): string[] {
  const maxChars = Math.max(6, Math.floor((w - 16) / BOX_CHAR_W))
  const lines: string[] = []
  let line = ""
  for (const word of label.split(/\s+/)) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.length > 1 ? lines : [label]
}
```

In `compileEl`'s `box` case (authored.ts:501-521), compute and carry lines:

```ts
      const label = el.label ?? null
      const lines = label ? wrapBoxLabel(label, w!) : undefined
      const out: FigureBoxEl = {
        kind: "figure-box",
        x: dx + x!,
        y: dy + y!,
        w: w!,
        h: h!,
        r: r === null ? 4 : r!,
        label,
        lines,
        tone: el.tone ?? "ink",
        fill: el.fill ?? null,
        ...identityOf(el, warn),
      }
```

In `src/figures/scene.ts`, `FigureBoxEl` gains one optional field after
`label`:

```ts
  label: string | null
  /** Pre-wrapped label lines (box-width wrap, spec §3.3). Absent = single line. */
  lines?: string[]
```

In `src/figures/svg.ts`, replace `figureBox`'s label construction:

```ts
function figureBox(el: FigureBoxEl, i: number): string {
  const fill = el.fill ? FIGURE_TONE_VAR[el.fill] : "none"
  const opacity = el.fill ? ` fill-opacity="0.12"` : ""
  let label = ""
  if (el.label) {
    const lines = el.lines && el.lines.length > 0 ? el.lines : [el.label]
    const cx = el.x + el.w / 2
    const cy = el.y + el.h / 2
    if (lines.length <= 1) {
      label = `<text x="${n2(cx)}" y="${n2(cy)}" text-anchor="middle" dominant-baseline="central" class="exp-fig-label">${escapeHtml(lines[0] ?? el.label)}</text>`
    } else {
      const pitch = 15
      const tspans = lines
        .map((line, li) => `<tspan x="${n2(cx)}" y="${n2(cy - ((lines.length - 1) * pitch) / 2 + li * pitch)}">${escapeHtml(line)}</tspan>`)
        .join("")
      label = `<text text-anchor="middle" dominant-baseline="central" class="exp-fig-label">${tspans}</text>`
    }
  }
  return (
    `<g class="exp-fig-box" style="--draw-i:${i}">` +
    `<rect x="${n2(el.x)}" y="${n2(el.y)}" width="${n2(el.w)}" height="${n2(el.h)}" rx="${n2(el.r)}" fill="${fill}"${opacity} stroke="${FIGURE_TONE_VAR[el.tone]}"/>` +
    label +
    `</g>`
  )
}
```

(Single-line emission is character-for-character today's markup; the sketch
pass skips text, so `sketch.ts` needs nothing.)

- [ ] **Step 4: GREEN** — same two test files, then full suite:
  `npx vitest run 2>&1 | grep -E "Tests |failed"`

- [ ] **Step 5: Corpus gate** (same three commands as Task 1 Step 5, output
  `.superpowers/corpus-task2.txt`). Expected `BYTE-IDENTICAL` — every demo box
  label already fits its box. **If a diff appears**, a demo label genuinely
  overflowed: show the diff, and treat the wrapped rendering as the fix (note
  it in the commit message) rather than bending the wrapper to preserve the
  overflow.

- [ ] **Step 6: Commit**

```bash
git add src/figures/authored.ts src/figures/scene.ts src/figures/svg.ts tests/figures/authored.test.ts tests/figures/svg.test.ts
git commit -m "figures: wrap box labels to the box width"
```

---

## Task 3: `label` sugar on leaf elements (`authored.ts`)

**Files:**
- Modify: `src/figures/authored.ts` (the `FigureEl` union at lines 28-35,
  `parseFigureElement` cases `curve`/`arc`/`line`/`dot`, `compileEl` → returns
  `SceneElement[]`, `flatten`)
- Test: `tests/figures/authored.test.ts`

**Interfaces:**
- Produces: `FigureEl` members `dot`/`line`/`curve`/`arc` accept
  `label?: string`. `compileEl(el, env, dx, dy, warn): SceneElement[]` — a
  shape with `label` returns `[shape, figure-label]`; the sugar label is
  `size: 11`, `anchor: "middle"`, carries **no id/tip** (identity stays on the
  shape — a duplicate id would lose the claim in `claimId`). Positions: dot →
  `(dx+cx, dy+cy-r-6)`; line → endpoint midpoint; curve → midpoint of
  `from`/`to` (not control points); arc → ellipse center.

- [ ] **Step 1: Failing tests** — in `tests/figures/authored.test.ts`

```ts
describe("figure label sugar on leaf elements", () => {
  it("renders a dot's label above the dot", () => {
    const { scene } = compileFigure({
      elements: [{ kind: "dot", cx: 130, cy: 100, r: 10, label: "Ionizable Lipid" }],
    })
    expect(scene.elements).toHaveLength(2)
    const [dot, lab] = scene.elements as [FigureDotEl, FigureLabelEl]
    expect(dot.kind).toBe("figure-dot")
    expect(lab.kind).toBe("figure-label")
    expect(lab.text).toBe("Ionizable Lipid")
    expect(lab.anchor).toBe("middle")
    expect(lab.x).toBe(130)
    expect(lab.y).toBeLessThan(dot.cy) // above the dot, not on it
    expect(lab.id).toBeUndefined() // identity stays on the shape
  })

  it("places a line's label at the endpoint midpoint", () => {
    const { scene } = compileFigure({
      elements: [{ kind: "line", x1: 100, y1: 75, x2: 260, y2: 125, label: "binds" }],
    })
    const lab = scene.elements[1] as FigureLabelEl
    expect(lab.x).toBe(180)
    expect(lab.y).toBe(100)
  })

  it("adds nothing when there is no label", () => {
    const { scene } = compileFigure({
      elements: [{ kind: "dot", cx: 130, cy: 100, r: 10 }],
    })
    expect(scene.elements).toHaveLength(1)
  })
})
```

- [ ] **Step 2: RED** — `npx vitest run tests/figures/authored.test.ts`
  Expected: 2 fail (no sugar), the no-label test passes (guard).

- [ ] **Step 3: Implement** — in the `FigureEl` union (authored.ts:28-35), add
  `label?: string` to the `curve`, `arc`, `line` and `dot` members (box already
  has it):

```ts
  | { kind: "curve"; from: XY; cp1: XY; cp2: XY; to: XY; tone?: Tone; width?: Num; label?: string; id?: string; tip?: string }
  | { kind: "arc"; cx: Num; cy: Num; rx: Num; ry: Num; start: Num; end: Num; tone?: Tone; width?: Num; label?: string; id?: string; tip?: string }
  | { kind: "line"; x1: Num; y1: Num; x2: Num; y2: Num; tone?: Tone; width?: Num; label?: string; id?: string; tip?: string }
  | { kind: "dot"; cx: Num; cy: Num; r?: Num; tone?: Tone; label?: string; id?: string; tip?: string }
```

In `parseFigureElement`, the four cases gain the same clause box already uses
(this is `dot`; mirror in `curve`/`arc`/`line`):

```ts
      return { kind: "dot", cx, cy, r: parseNum(raw.r), tone: parseTone(raw.tone), label: typeof raw.label === "string" && raw.label.trim() !== "" ? raw.label : undefined, id: parseId(raw.id, warn), tip: parseTip(raw.tip, warn) }
```

Change `compileEl` to return an array. Signature and every `return out`
become `return [out]`; `case "group": return []`. Then add sugar at the end of
the four cases (this is `dot` — `r!` is already resolved above):

```ts
      const out: FigureDotEl = { kind: "figure-dot", cx: dx + cx!, cy: dy + cy!, r: r === null ? 3 : r!, tone: el.tone ?? "accent", ...identityOf(el, warn) }
      const result: SceneElement[] = [out]
      if (el.label) {
        result.push({ kind: "figure-label", x: dx + cx!, y: dy + cy! - (r === null ? 3 : r!) - 6, text: el.label, size: 11, anchor: "middle" })
      }
      return result
```

For `line` (after `out`, y2!), `for curve` use the from/to midpoint, for `arc`
the ellipse center:

```ts
      if (el.label) {
        result.push({ kind: "figure-label", x: dx + (x1! + x2!) / 2, y: dy + (y1! + y2!) / 2, text: el.label, size: 11, anchor: "middle" })
      }
```

In `flatten` (authored.ts:588-618), replace the single push:

```ts
    const compiled = compileEl(el, env, dx, dy, warn)
    for (const c of compiled) {
      if (out.length >= MAX_ELEMENTS) {
        warn(`figure-too-many: scene truncated at ${MAX_ELEMENTS} elements`)
        return
      }
      out.push(c)
    }
```

(Sugar labels count toward the 60-element scene cap, like any authored label.)

- [ ] **Step 4: GREEN + full suite** — `npx vitest run 2>&1 | grep -E "Tests |failed" && npx tsc --noEmit && echo TSC-CLEAN`

- [ ] **Step 5: Corpus gate** — same commands, output `.superpowers/corpus-task3.txt`.
  Expected `BYTE-IDENTICAL` (no demo leaf element carries `label`).

- [ ] **Step 6: Commit**

```bash
git add src/figures/authored.ts tests/figures/authored.test.ts
git commit -m "figures: honor label on leaf elements (dot/line/curve/arc)"
```

---

## Task 4: Teach the contract, then verify against the real model

**Files:**
- Modify: `src/core/blockTypes.ts` (the `figure:` line of `BLOCK_TYPE_DOCS`)
- Test: existing pins (`tests/presentation.test.ts:99-114`,
  `tests/llm.test.ts`) must stay green — the additions do not remove any
  pinned substring.

- [ ] **Step 1: Edit the figure contract line.** In the `figure:` entry of
  `BLOCK_TYPE_DOCS`, replace
  `Leaf elements accept optional id (identifier, ≤100 chars) and tip (≤200 chars, shown on hover); give ids/tips only to elements worth explaining. Label everything; ≤60 elements.`
  with

```
Leaf elements accept optional id (identifier, ≤100 chars), tip (≤200 chars, shown on hover), and label (rendered beside the shape); give ids/tips only to elements worth explaining. Label everything; ≤60 elements. Keep every element inside the 360×240 canvas and spread elements out — stacked or out-of-canvas elements are unreadable; give each box room for its label (long labels wrap to the box width).
```

- [ ] **Step 2: Suite + corpus gate** (prompt text cannot affect rendering, but
  run it anyway — it is two commands):

```bash
npx vitest run 2>&1 | grep -E "Tests |failed" && npx tsc --noEmit && echo TSC-CLEAN
npm run build 2>&1 | tail -1
node .superpowers/render-fixtures.mjs dist .superpowers/corpus-task4.txt
diff .superpowers/corpus-main.txt .superpowers/corpus-task4.txt && echo BYTE-IDENTICAL
```

- [ ] **Step 3: Commit**

```bash
git add src/core/blockTypes.ts
git commit -m "figures: teach the scene contract (canvas bounds, spacing, label sugar)"
```

- [ ] **Step 4: The acceptance re-run** (spec §4.4). Fresh outputs, then the
  probe:

```bash
mv .superpowers/real-compile .superpowers/real-compile-run3
node --env-file=.env.local .superpowers/real-compile.mjs > .superpowers/real-compile.log 2>&1
node .superpowers/shoot-mrna-figures.mjs .superpowers/real-compile/how-mrna-vaccines-work.html > .superpowers/mrna-figures-report3.json 2>&1
```

Read the report with the same "problems only" snippet used on run 1. Record
honestly: expected improvement is (a) zero OUTSIDE-CANVAS on figure SVGs
(viewBox grows even if the model still strays), (b) fewer/zero label overlaps
(wrapping + the taught spacing). If the model still stacks elements, that is a
model-behaviour finding to record in the ledger, not a reason to bend the
renderer.

---

## Task 5: Docs + final verification

**Files:**
- Modify: `README.md` (Figures section), `docs/ROADMAP.md` (backlog),
  `docs/DEBUGGING.md` (the probe trap)

- [ ] **Step 1: README** — in `## Figures`, after the paragraph on per-element
  tips, add:

> A figure's content may stray outside its 360×240 canvas — hand-authored
> figures stay inside, model-authored ones sometimes don't. The renderer grows
> the `viewBox` to contain whatever is there (possibly scaling the figure down
> slightly), so out-of-canvas content degrades to "a bit small" instead of
> disappearing. Box labels wrap to the box width, and a `label` on a
> `dot`/`line`/`curve`/`arc` renders beside the shape — the model's most
> natural spelling of "name this thing".

- [ ] **Step 2: ROADMAP** — in Backlog, add a `**Figure scene quality**
(2026-10-07) — SHIPPED.` entry pointing at the spec, with the three measured
defects and what changed; and append to the existing skip-rank item one line:
`A real-model compile hit both defects on 2026-10-07 (dc→tcell skip edge
through the MHC node, label on the node) — the fix now has a live instance.`

- [ ] **Step 3: DEBUGGING Part 2 entry** — the probe trap this cycle hit:

```markdown
### 2026-10-07 — `getBBox()` ignores the element's own transform
- **Symptom:** the figure-measurement probe reported two diagram edge labels as OUTSIDE-CANVAS at negative coordinates — while the served SVG had them correctly placed at `translate(400,24.5)` inside the scene. One false alarm burned a diagnosis round.
- **Root cause:** `SVGGraphicsElement.getBBox()` returns the box in the element's LOCAL user space — before the element's own `transform` maps it into the parent. A `<text transform="translate(x,y)">` whose tspans sit around the origin reports a bbox around the origin. Meanwhile a REAL defect was hiding behind the false one: the same probe's text-vs-text overlaps used local coords too, so the true collision (edge label on a node label) was invisible until the probe was fixed.
- **Fix:** map each text's SCREEN rect through `svg.getScreenCTM().inverse()` (corner points via `DOMPoint.matrixTransform`) so every measurement lands in true scene coordinates, transforms included.
- **Rule:** never trust `getBBox()` for scene-space geometry on transformed elements — either map through the inverse CTM or strip transforms in a fixture. And when a measurement reports two problems where the user reported one, suspect the probe before believing the bonus bug.
```

- [ ] **Step 4: Final gate** — everything, in order:

```bash
npx vitest run 2>&1 | grep -E "Tests |Test Files |failed"
npx tsc --noEmit && echo TSC-CLEAN
npm run build 2>&1 | tail -1
node .superpowers/render-fixtures.mjs dist .superpowers/corpus-final.txt
diff .superpowers/corpus-main.txt .superpowers/corpus-final.txt && echo BYTE-IDENTICAL
launchctl remove explanations-demo 2>/dev/null; launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"; sleep 1
for r in / /document /interactive /math /editorial /compile; do printf "%s %s  " "$r" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4173$r)"; done; echo
```

Expected: all tests pass, TSC-CLEAN, build green, BYTE-IDENTICAL, 6 routes 200.

- [ ] **Step 5: Ledger + merge gate.** Append the cycle line to
  `.superpowers/sdd/progress.md` (commits, verification, acceptance numbers,
  NOT merged — merge gate), then present the work: diff stat, the regenerated
  mRNA page, the probe report, and the corpus-gate result. Do NOT merge or
  push without the user's explicit go-ahead (AGENTS.md merge gate).

---

## Self-review (done at plan time)

- **Spec coverage:** §3.1 grow → Task 1; §3.2 label sugar → Task 3; §3.3 wrap
  → Task 2; §3.4 prompt → Task 4; §4.4 acceptance → Task 4 Step 4; §5 gates →
  every task's corpus step + Task 5 Step 4. Out-of-scope items (skip-rank,
  stripped-field warnings, compile-time validation) appear nowhere — correct.
- **Placeholder scan:** every code step carries full code; the only
  judgement-call contingencies (corpus diffs in Tasks 1/2) name their exact
  resolution paths.
- **Type consistency:** `FigureBoxEl.lines?: string[]` used identically in
  Tasks 2's three files; `compileEl`'s array return is defined in Task 3 and
  consumed by `flatten` in the same task; `FigureLabelEl` fields match
  `scene.ts:155-163`.

