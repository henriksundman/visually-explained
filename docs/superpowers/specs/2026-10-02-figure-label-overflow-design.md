# Figure Label Overflow — Design

**Date:** 2026-10-02
**Status:** Approved (brainstorm 2026-10-02 — behaviour choices locked in
session)
**Type:** Library bug fix. Found via the `/editorial` showcase
(`2026-10-02-editorial-showcase-design.md`), which surfaced two pre-existing
latent bugs by using realistically long labels.
**Evidence:** `docs/superpowers/specs/assets/figure-label-overflow-diagram.jpg`,
`...-chart.jpg`

## 1. Problem

Two figure layouts place label text at fixed coordinates **without ever
measuring it**. Any label longer than the space it is centred in spills over
its neighbours; because nodes and bars paint after (or around) that text, the
labels are eclipsed.

Measured against the reported reproductions (13px label class; ~6.6px/char):

**Diagram — edge labels eclipsed by node boxes**

```
gutter between node boxes:  64px   (fixed GAP_MAIN)
"slant path — up to 38× the vertical"   ≈ 231px  (3.6× the gutter)
"back-scattered light, blue mostly gone" ≈ 251px  (3.9× the gutter)
```

`layoutFlow` centres `labelX` on the gutter midpoint. A 231px label in a 64px
gutter overhangs ~90px onto each neighbour. Nodes are emitted after edges with
an opaque fill (`node-box` → `fill="var(--exp-node-fill)"`), so they paint over
the label.

**Chart — value labels collide and clip**

```
band width: 59.1px
"0.62relative intensity" ≈ 145px → collides with its neighbours
"0.11relative intensity" ≈ 145px → collides AND clips past the viewBox
```

Two defects: (a) `fmtValue` concatenates the unit onto **every** value label
with no separator, producing `0.62relative intensity`; (b) value labels are
placed at a fixed offset with no check against the band width or the scene
bounds.

**Shared root cause:** the figure system measures text in exactly one place —
node labels, via `layoutFlow.wrapLabel`, whose output is documented as
"Pre-wrapped lines (layout-owned)". Edge labels and chart value labels were
never given the same treatment.

### Not a bug

The dark box in the diagram screenshot reading `Diagram: Sun → Atmosphere →
Your eye` is the browser's **native tooltip for the SVG `<title>` element** —
the figure's accessible name, which every renderer emits
(`aria-label` + `<title>`). It appears on hover, by design and by HTML
standard. The library's own styled popover is React-only
(`src/react/ElementPopover.tsx`); static rendering has none. No change.

### Also observed, explicitly not fixed here

In the **sketch** pass, arrow labels are dropped entirely — `sketchElementSvg`
emits only the shaft and head, and `sceneToSvg`'s sketch branch re-emits labels
only for `node-box` and `label` elements. Real and pre-existing, but
orthogonal; recorded here rather than bundled into this fix.

## 2. Decisions (locked in brainstorm, 2026-10-02)

1. **Wrap edge labels; never drop them.** A diagram edge label wraps to lines
   that fit the gutter, mirroring how node labels already work. Chosen over
   widening the gutter (a 38-character label would force a ~700px-wide figure)
   and over dropping labels that cannot fit.
2. **Wrapping to the gutter width is what guarantees no overlap.** If every
   wrapped line is ≤ the gutter, the label's horizontal extent is confined to
   the gutter column, so it cannot intersect a node box at any line count. No
   separate collision pass is needed.
3. **Chart unit shown once.** Bare numbers on the marks, unit printed once
   above the plot — how a printed chart does it. This removes the missing
   separator and the repetition in one change.
4. **Degrade, never overlap.** A value label too wide for its band is omitted;
   the bar height, the unit row and the hover tip still convey the value. The
   house rule is lenient salvage, not clipping.
5. **No text measurement library.** The repo's binding decisions forbid new
   dependencies and hand-roll utilities. Layout keeps deterministic character
   width estimates — the same technique `wrapLabel` already uses.
6. **Single-line output stays byte-identical.** A diagram edge label that fits
   on one line emits exactly the same markup as today, so no existing snapshot
   or test churns.

## 3. Design

### 3.1 Diagram edge labels (`layoutFlow.ts`)

- `ArrowEl` gains `lines?: string[]`, mirroring `NodeBoxEl.lines`
  ("Pre-wrapped lines (layout-owned)").
- For each edge, the available width is the gutter it is routed through:
  `b.x - (a.x + a.w)` for an adjacent left-to-right edge; the same measure for
  the skip-rank gutter route, and the vertical gap for `tb`. Wrap the label to
  that width with the existing `wrapLabel` helper, plus a dedicated
  `wrapEdgeLabel` that drops the 24px node padding and hard-splits over-long
  words (a single token wider than the gutter must not overflow).
- `labelY` becomes the **vertical centre** of the wrapped block, so one line and
  three lines are both centred on the edge.
- Line pitch 15px at the 11px `.exp-edge-label` size.
- Scene extents grow to contain any label block that reaches past the node
  bounds, so a tall wrapped label is never clipped by the viewBox.

Known consequence, stated plainly: 64px at ~6.0px/char is roughly 10 characters
per line, so a 35-character label becomes ~4 short lines. That is legible and
non-overlapping, which is the goal; a label-aware gutter width remains a
reasonable future refinement if the wrapped result reads as too narrow.

### 3.2 Emit layer (`svg.ts`)

- `arrow()` emits a single `<text>` exactly as today when `lines` is absent or
  one line; for multiple lines it emits one `<text>` with `<tspan>` children
  positioned around `labelY`, mirroring `nodeLabel`'s existing multi-line
  branch. One text element keeps `text-anchor="middle"` semantics and the
  existing transform.

### 3.3 Chart value labels (`layoutChart.ts`)

- `fmtValue` emits the bare number; the unit is no longer concatenated. This
  also changes `BarEl.valueLabel`, whose doc comment says "unit already
  applied" — updated to "preformatted value, no unit". The field has no
  consumer outside `scene.ts` today; it is kept, not removed, to keep this fix
  to the defect.
- The unit is emitted once as a muted `label` element on its own row above the
  plot: `PAD_T` grows 16 → 40, unit baseline `y: 12`, anchored start at
  `PAD_L`. Its own row is what keeps it clear of the tallest mark's value
  label — no horizontal reasoning required, whatever the data does.
- A value label is emitted only when its estimated width fits its band minus a
  4px tolerance; otherwise it is omitted (decision 4). Band tolerance uses the
  emphasis class's wider per-character estimate (11px at weight 650).

### 3.4 Contract test that changes

`tests/figures/layout-chart.test.ts` asserts `texts).toContain("240ms")` —
it **pins the buggy behaviour**. Per `docs/DEBUGGING.md` Part 1 ("The test may
be the bug"), the expectation is re-derived from this spec: values are bare,
and the unit appears exactly once. The test's name changes with it.

## 4. Testing

Deterministic geometry assertions on the Scene (no rendering, no jsdom):

- **Edge label fits the gutter.** For the reported reproduction, every wrapped
  line's estimated width ≤ the gutter, and the label block's horizontal extent
  intersects no node box.
- **Long single word is hard-split**, not allowed to overflow.
- **Single-line labels emit no `lines`** (byte-identical output preserved).
- **Scene contains the label block** — a long label raises the scene extent
  rather than clipping.
- **Chart values are bare; unit appears once.** No label text contains the unit
  suffix; exactly one element's text equals the unit.
- **Oversized value labels are omitted**, and the bar still renders.
- **Existing suite stays green** (the `240ms` expectation re-derived).

## 5. Out of Scope

- Sketch-pass arrow labels being dropped (recorded in §1).
- Rotating or otherwise compacting long chart values.
- Any measurement via canvas or `getComputedTextLength` — non-deterministic and
  unavailable at SSR time.
- Reflowing the diagram to give edge labels more room (a future refinement, §3.1).
- Any change to the `/editorial` showcase itself.

## 6. Sequencing

Fix on its own branch `fix/figure-label-overflow`, merged **before** the
showcase branch, so the showcase is reviewed against a fixed library. The
showcase branch stays open until then.