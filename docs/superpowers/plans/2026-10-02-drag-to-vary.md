# Drag-to-vary Simulations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo executes plans **inline** — no CLI subagents (AGENTS.md).

**Goal:** Let a reader drag an authored figure element and have the rest of the
figure re-solve around it, by writing to the same `param` a slider writes.

**Architecture:** One new optional block key (`draggable`) parsed leniently
into the existing `AuthoredFigure`, one pure geometry module (client→scene
conversion + clamping) with no React or DOM dependency, and one React hook
wiring pointer + keyboard events to the existing `values` state. No new render
path and no new value namespace: `buildEnv` already seeds one flat env from
`params[].initial`, `dot.cx`/`box.x` already accept expressions, and `dot`/
`box` already carry `id` → `data-el-id`. A drag is a second input device
writing to state that already exists.

**Tech Stack:** TypeScript (ES2022, strict), zod, vitest (node env), tsup,
React 18 (`use client`).

**Spec:** `docs/superpowers/specs/2026-10-02-drag-to-vary-design.md`
(approved 2026-10-02).

## Global Constraints

- **Scene coordinates never enter the drag path.** A drag writes a *number* into
  `values`; the existing compile re-solves every coordinate from it.
- **The static renderer is untouched.** `renderBlock` output must be
  byte-identical to `main` for every figure, draggable or not. Drag is a React
  runtime feature, like sliders.
- **A drag must never silently no-op.** If both coordinate conversions fail,
  the pointer is ignored *and no param is written* — never a wrong value.
- **`step` is ignored on a drag**; `min`/`max` still bound it. `step` is a
  slider affordance; a pointer has no need for it, and honouring it makes a
  dragged point stick and jump.
- **Clamp the lower bound last** (`min(max(x, hi), lo)`), so a degenerate
  `min > max` from an LLM cannot let the wrong bound win (DEBUGGING.md Part 1).
- **Keyboard access is part of the feature**, not a follow-up: arrows,
  Shift+arrows, Home/End on every declared draggable.
- **No jsdom** (vitest node env). Geometry is tested as pure functions over
  plain objects, exactly as `placePopover` is tested in `figureEvents.ts`.
- **One change per commit**, each independently green.
- **No new dependencies.**
- **Verification:** `npm run typecheck`, `npm test`, `npm run build`. Baseline
  at branch start: **401 tests / 44 files, all green**.
- **Branch:** `feature/drag-to-vary`, cut from `main` (`d5e1640`).
- **Ledger:** append a line to `.superpowers/sdd/progress.md` per task
  (git-ignored — never `git add .superpowers`).

## Interfaces produced across tasks

| Symbol | Module | Task |
|---|---|---|
| `DraggableSpec`, `AuthoredFigure.draggable?` | `src/figures/authored.ts` | 1 |
| `figureBlockSchema.draggable?` | `src/core/schema.ts` | 1 |
| `clientToScene`, `clampParam`, `dragValueFor` | `src/react/dragGeometry.ts` | 2 |
| `useDragVary` | `src/react/useDragVary.ts` | 3 |
| `BLOCK_TYPE_DOCS` draggable clause | `src/core/blockTypes.ts` | 4 |
| `/interactive` draggable demo figure | `demo/*` | 5 |

---

### Task 1: Parse `draggable` into the authored figure

**Files:**
- Modify: `src/core/schema.ts` (`figureBlockSchema`)
- Modify: `src/figures/authored.ts` (`AuthoredFigure`, parsing)
- Modify: `src/primitives/figure.ts` (`buildAuthored`)
- Test: `tests/figure.test.ts`

**Notes:** `sweep` is the precedent to copy — it is declared on the schema,
read off `raw` by the React runtime, and is *not* carried on `AuthoredFigure`.
Follow that: `draggable` is parsed by `buildAuthored` into `AuthoredFigure`
(the React runtime needs it) but must not change what `renderFigure` emits.

- [ ] **Step 1: Write the failing tests**

`tests/figure.test.ts` currently imports only the render entry points; add
`buildAuthored` to its imports. Append:

```ts
import { buildAuthored } from "../src/primitives/figure"

describe("draggable parsing", () => {
  const base = {
    type: "figure" as const,
    params: [{ name: "r", min: 0, max: 360, step: 1, initial: 120 }],
    elements: [{ kind: "dot" as const, id: "bob", cx: "r", cy: 130, r: 6 }],
  }

  it("parses a draggable entry and drops unknown keys", () => {
    const w: string[] = []
    const a = buildAuthored(
      { ...base, draggable: [{ id: "bob", x: "r", y: "nope", bogus: 1 }] } as never,
      w,
    )
    expect(a.draggable).toEqual([{ id: "bob", x: "r", y: "nope" }])
  })

  it("warns and drops an entry with no axis", () => {
    const w: string[] = []
    const a = buildAuthored({ ...base, draggable: [{ id: "bob" }] } as never, w)
    expect(a.draggable).toEqual([])
    expect(w.join(" ")).toContain("figure-drag-no-axis")
  })

  it("warns and drops an id that violates the element-id rule", () => {
    const w: string[] = []
    const a = buildAuthored({ ...base, draggable: [{ id: "bad id!", x: "r" }] } as never, w)
    expect(a.draggable).toEqual([])
    expect(w.join(" ")).toContain("figure-drag-id-invalid")
  })

  it("bounds the entry count", () => {
    const w: string[] = []
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, x: "r" }))
    const a = buildAuthored({ ...base, draggable: many } as never, w)
    expect(a.draggable!.length).toBeLessThanOrEqual(16)
    expect(w.join(" ")).toContain("figure-drag-too-many")
  })

  it("leaves draggable undefined when absent — the common case is untouched", () => {
    const w: string[] = []
    const a = buildAuthored(base as never, w)
    expect(a.draggable).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run them — they must fail**

`npm test -- tests/figure.test.ts` → failures on `a.draggable`.

- [ ] **Step 3: Add the schema field**

In `src/core/schema.ts`, inside `figureBlockSchema` (beside `sweep`). Note the
id uses the **element-id** rule (`/^[\w][\w-]*$/`, ≤100 chars), *not*
`figureNamePattern` — that one is for evaluator identifiers and forbids
hyphens, which element ids legitimately contain:

```ts
const figureElementIdPattern = /^[\w][\w-]*$/

// …inside figureBlockSchema:
draggable: z
  .array(
    z.object({
      id: z.string().regex(figureElementIdPattern, "must be an element id"),
      x: z.string().optional(),
      y: z.string().optional(),
    }),
  )
  .max(16)
  .optional(),
```

- [ ] **Step 4: Carry it on `AuthoredFigure` and parse it**

In `src/figures/authored.ts`:

```ts
export interface DraggableSpec {
  /** Element id of a dot/box leaf; validated against the element-id rule. */
  id: string
  /** Param name the horizontal drag writes; absent ⇒ x is fixed. */
  x?: string
  /** Param name the vertical drag writes; absent ⇒ y is fixed. */
  y?: string
}

/** Accepts the module-private EL_ID_RE so there is exactly one id rule in the
 *  codebase. `warn` is a callback, matching parseId's signature. */
export function parseDraggables(raw: unknown, warn: (m: string) => void): DraggableSpec[] | undefined
```

It returns `undefined` when the input is absent (so the common case is
untouched), drops an entry with neither axis (`figure-drag-no-axis`), an id
failing `EL_ID_RE`/100 chars (`figure-drag-id-invalid`), and warns past 16
(`figure-drag-too-many`).

In `src/primitives/figure.ts` `buildAuthored(block, warnings)` — note the
second parameter is a **`string[]`, not a callback** — add:

```ts
draggable: parseDraggables(block.draggable, m => warnings.push(m)),
```

- [ ] **Step 5: Verify the static render is unchanged**

```bash
npm run typecheck && npm test && npm run build
```

Then the byte-diff against `main` (Task 6 helper) — **must be identical** for
every existing figure.

- [ ] **Step 6: Commit**

```
add draggable to the figure block and parse it leniently
```

---

### Task 2: Pure drag geometry

**Files:**
- Create: `src/react/dragGeometry.ts`
- Test: `tests/react-drag-geometry.test.ts`

**Why a separate module:** no jsdom, so the coordinate math must be testable as
pure functions over plain objects. Keeping it DOM-free also keeps it honest —
nothing here can accidentally depend on a live element.

- [ ] **Step 1: Write the failing tests**

Create `tests/react-drag-geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { clientToScene, clampParam, dragValueFor } from "../src/react/dragGeometry"

describe("clientToScene", () => {
  it("maps a client point through the screen CTM", () => {
    // scale 2, translate 100 — a point at client x=300 is scene x=100.
    const m = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }
    const p = clientToScene({ clientX: 300, clientY: 250 }, { matrix: m, rect: null, viewW: 360, viewH: 240 })
    expect(p).toEqual({ x: 100, y: 100 })
  })

  it("falls back to the bounding rect when there is no matrix", () => {
    // rect is 720x480 for a 360x240 viewBox ⇒ scale 2, no translation.
    const p = clientToScene(
      { clientX: 300, clientY: 250 },
      { matrix: null, rect: { left: 0, top: 0, width: 720, height: 480 }, viewW: 360, viewH: 240 },
    )
    expect(p).toEqual({ x: 150, y: 125 })
  })

  it("returns null when both sources are unavailable — a drag must not guess", () => {
    const p = clientToScene(
      { clientX: 10, clientY: 10 },
      { matrix: null, rect: null, viewW: 360, viewH: 240 },
    )
    expect(p).toBeNull()
  })

  it("returns null for a degenerate (zero-scale) rect", () => {
    const p = clientToScene(
      { clientX: 10, clientY: 10 },
      { matrix: null, rect: { left: 0, top: 0, width: 0, height: 0 }, viewW: 360, viewH: 240 },
    )
    expect(p).toBeNull()
  })
})

describe("clampParam", () => {
  it("clamps to the declared range", () => {
    expect(clampParam(500, { min: 0, max: 360 })).toBe(360)
    expect(clampParam(-5, { min: 0, max: 360 })).toBe(0)
  })

  it("clamps the LOWER bound last, so min > max cannot win the wrong way", () => {
    // Degenerate LLM-authored range: the lower bound is applied last.
    expect(clampParam(50, { min: 100, max: 10 })).toBe(100)
  })

  it("passes an in-range value through untouched", () => {
    expect(clampParam(42, { min: 0, max: 360 })).toBe(42)
  })
})

describe("dragValueFor", () => {
  it("ignores the slider step and keeps the raw pointer value", () => {
    // step 5 would quantise 137.4 → 135; a drag must not.
    expect(dragValueFor(137.4, { min: 0, max: 360, step: 5 })).toBeCloseTo(137.4, 6)
  })

  it("applies the grab offset so the element does not snap to the cursor", () => {
    // pointer at scene 100, element at 80 ⇒ grabbed 20px to the right.
    expect(dragValueFor(100 + 20, { min: 0, max: 360, step: 1 }, { value: 80, grabOffset: 20 })).toBe(100)
  })
})
```

- [ ] **Step 2: Run — must fail** (module not found)

- [ ] **Step 3: Implement**

```ts
/** Client point → scene coordinates. Matrix path is exact under any CSS
 *  transform; the rect fallback is weaker but keeps the feature alive.
 *  Returns null when neither is usable — the caller then writes nothing. */
export function clientToScene(
  pt: { clientX: number; clientY: number },
  src: {
    matrix: { a: number; b: number; c: number; d: number; e: number; f: number } | null
    rect: { left: number; top: number; width: number; height: number } | null
    viewW: number
    viewH: number
  },
): { x: number; y: number } | null
```

Invert the 2×3 affine matrix for the primary path; divide by the rect scale for
the fallback; return `null` for a zero/absent scale. This implementation was
run against every expectation in Step 1 before the plan was written, so the
numbers above are measured, not predicted:

```ts
/** Inverse of a 2x3 affine matrix [a c e; b d f]. Returns null on a
 *  singular (zero-determinant) matrix rather than dividing by zero. */
function invertAffine(
  p: { clientX: number; clientY: number },
  m: { a: number; b: number; c: number; d: number; e: number; f: number },
): { x: number; y: number } | null {
  const det = m.a * m.d - m.b * m.c
  if (!det || !Number.isFinite(det)) return null
  return {
    x: (m.d * (p.clientX - m.e) - m.c * (p.clientY - m.f)) / det,
    y: (-m.b * (p.clientX - m.e) + m.a * (p.clientY - m.f)) / det,
  }
}

export function clientToScene(
  pt: { clientX: number; clientY: number },
  src: {
    matrix: { a: number; b: number; c: number; d: number; e: number; f: number } | null
    rect: { left: number; top: number; width: number; height: number } | null
    viewW: number
    viewH: number
  },
): { x: number; y: number } | null {
  if (src.matrix) {
    const r = invertAffine(pt, src.matrix)
    if (r) return r
  }
  if (src.rect && src.rect.width > 0 && src.rect.height > 0) {
    return {
      x: (pt.clientX - src.rect.left) * (src.viewW / src.rect.width),
      y: (pt.clientY - src.rect.top) * (src.viewH / src.rect.height),
    }
  }
  return null
}

/** Clamp with the LOWER bound applied last, so a degenerate `min > max`
 *  (LLM-authored) resolves to `min` rather than letting `max` win. */
export function clampParam(v: number, range: { min: number; max: number }): number {
  return Math.max(range.min, Math.min(range.max, v))
}

/** A drag writes the raw pointer-derived value: the slider's `step` is
 *  ignored on purpose, and the grab offset is removed so the element does not
 *  snap its centre to the cursor on contact. */
export function dragValueFor(
  sceneValue: number,
  spec: { min: number; max: number; step: number },
  opts?: { value: number; grabOffset: number },
): number {
  const raw = opts ? sceneValue - opts.grabOffset : sceneValue
  return clampParam(raw, spec)
}
```

- [ ] **Step 4: Verify, then commit**

```bash
npm run typecheck && npm test
```

```
add pure client-to-scene drag geometry
```

---

### Task 3: The React drag + keyboard layer

**Files:**
- Create: `src/react/useDragVary.ts`
- Modify: `src/react/InteractiveFigure.tsx`
- Modify: `src/react/index.ts` (export the hook)
- Test: `tests/react.test.tsx`

**Interfaces:**
- Consumes: `clientToScene`, `clampParam`, `dragValueFor` (Task 2);
  `AuthoredFigure.draggable` (Task 1); existing `setParam` state.
- Produces: `useDragVary({ authored, params, values, setParam, stageRef })`
  returning `{ bind, draggableIds, activeId }`.

- [ ] **Step 1: Write the failing tests**

The pointer path needs a DOM; assert the *decisions* that don't:

```ts
describe("drag param resolution", () => {
  it("resolves a declared axis to its param and leaves the other fixed", () => {
    const d = [{ id: "bob", x: "r" }]
    expect(dragAxes(d, "bob")).toEqual({ x: "r", y: undefined })
  })

  it("reports an undeclared id as not draggable", () => {
    expect(isDraggable([{ id: "bob", x: "r" }], "nope")).toBe(false)
  })

  it("nudges by the axis increment, not the param step", () => {
    // step 5 must not quantise a keyboard nudge.
    expect(nudge(137, 1, 1)).toBe(138)
    expect(nudge(137, 1, 10)).toBe(147)
  })
})
```

- [ ] **Step 2: Run — must fail**

- [ ] **Step 3: Implement the hook**

`useDragVary` attaches `onPointerDown` to the stage (delegated, matching the
existing `useElementPopover` pattern — the SVG is injected via
`dangerouslySetInnerHTML`, so there are no React elements to attach to):

- `onPointerDown`: `hitElement(target)`; if the id is declared draggable,
  record the axis params and the grab offset, then
  `setPointerCapture(pointerId)` on the SVG root. **Capture is mandatory** —
  without it the drag dies when the cursor outruns a moving handle.
- `onPointerMove`: convert, write via `dragValueFor` + the existing
  `setParam`. Read the CTM/rect from the `<svg>` found inside `stageRef`.
- `onPointerUp` / `onPointerCancel`: release capture and clear state. A
  cancelled drag **leaves the param at its last written value** — a
  half-finished drag is not an error state.
- Keyboard: on a focused draggable, arrows nudge (`nudge`, scene-relative,
  ignoring `step`), Shift+Arrow coarser, `Home`/`End` to min/max.

Emit `data-draggable="x"|"y"|"xy"` on declared wrappers so the attribute is
assertable and the CSS hook exists. **Presence before geometry**: a test
asserts the attribute is present before any test asserts positions.

- [ ] **Step 4: Wire it into `InteractiveFigure`**

One call to `useDragVary` in the existing component; spread `bind` alongside
the existing popover `bind` on `.exp-fig-stage`. No change to the SSR path —
nothing new is read during render.

- [ ] **Step 5: Verify, then commit**

```bash
npm run typecheck && npm test && npm run build
```

```
wire drag and keyboard control into the interactive figure runtime
```

---

### Task 4: Theme + LLM authoring docs

**Files:**
- Modify: `src/themes/tokens.css`
- Modify: `src/core/blockTypes.ts`

- [ ] **Step 1: Add the theme rules**

Beside the existing figure rules: `cursor: grab` / `:active { cursor: grabbing }`
on `[data-draggable]`, `touch-action: none` (or the browser's own scroll
cancels the drag mid-flight), and a visible `:focus-visible` ring reusing the
library's existing focus treatment.

- [ ] **Step 2: Teach the format in `BLOCK_TYPE_DOCS`**

Extend the `figure` line with `draggable?: [{ id, x?, y? }]`, stating that the
element's coordinate must be expression-driven and that a missing axis is
fixed. Registration and docs ship atomically (`tests/llm.test.ts`).

- [ ] **Step 3: Verify, then commit**

```bash
npm run typecheck && npm test
```

```
style draggable handles and document the format for authors
```

---

### Task 5: Demo figure

**Files:**
- Modify: `demo/interactive.html` (or the figure source it loads)

- [ ] **Step 1: Add one draggable figure**

A handle bound to a param that a **visible slider also drives** — so the page
demonstrates the shared state (drag the handle, the slider thumb follows)
rather than a drag in isolation. Include a `detail` caption explaining it.

- [ ] **Step 2: Verify in the browser**

`npm run build`, restart the demo server, then in a **separate** call:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/interactive   # expect 200
```

Confirm by hand: the handle drags, the slider tracks it, arrow keys move it
when focused, and nothing shifts on first paint.

- [ ] **Step 3: Commit**

```
demo a draggable handle sharing state with its slider
```

---

### Task 6: Final verification

- [ ] **Step 1: Full gate**

```bash
npm run typecheck && npm test && npm run build
```

Expect **≥ 401 tests / 44 files**, all green (401 is the baseline; this plan
adds tests).

- [ ] **Step 2: Byte-diff the static render against `main`**

The static renderer must be untouched. In a `main` worktree, render every
figure in `demo/examples.js` and diff against the branch — **must be identical**:

```bash
git worktree add -q --detach /tmp/main-wt main
(cd /tmp/main-wt && npm install --silent && npm run build)
# render both, diff, then: git worktree remove --force /tmp/main-wt
```

- [ ] **Step 3: Confirm no `pointerdown` handler leaked into the static path**

```bash
grep -rn "onPointerDown\|pointerdown" src/figures/ src/primitives/   # expect no hits
```

- [ ] **Step 4: Browser pass on `/interactive`**

Drag, keyboard, slider sync, and a clean first paint (no hydration shift).

- [ ] **Step 5: Update `docs/DEBUGGING.md` if the session surfaced a lesson**, append the ledger line, then present for the merge gate.

## Out of Scope (restated, spec §3)

Groups (no identity in v1), multi-touch, snapping/undo, a figure editor, and
dragging non-`figure` blocks. If implementation starts letting a reader
*create* geometry, it has left this plan.
