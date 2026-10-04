# Cycle-aware flow layering, back-edge return paths, and the scene-clamp alignment bug

Fixes the `howToIr` pipeline diagram on the main demo page (`/`): arrows that
align with the **top** of their nodes instead of the middle, and a figure so
wide it renders at half scale with barely legible text.

## 1. The problem, stated precisely

The subject is one fixture — `howToIr`'s `diagram` block, `demo/examples.js`
("request → cache lookup → fresh/origin → revalidate → cache"). It contains a
cycle: `reval → cache` closes a loop back to a node three ranks earlier.

`layoutFlow` (`src/figures/layoutFlow.ts`) layers with **capped relaxation**
(step 3), which cannot terminate on a cycle. Every pass finds an edge whose
target can still be pushed, so `layer` keeps growing until the pass cap stops
it:

```
req=0  cache=16  fresh=14  origin=14  reval=15
```

Ranks 1–13 are empty. Three defects fall out of that single fact, in order:

**(a) The figure is twice as wide as it needs to be.** `mainOffset` advances
once per rank including the empty ones, so the scene is **1556px** wide. The
emit layer writes `viewBox="0 0 1556 …"` with `width:100%` (no explicit width
attribute), so the figure scales *down* to fit the column — **0.49×** at the
demo's ~760px. 13px node labels render at ~6.4px. That is the "very small,
barely legible" complaint, and it is pre-existing: the same page's other
diagram (`figuresIr`, no cycle) lays out at 774px and scales 0.98× with the
same font, and is perfectly legible.

**(b) A label is shredded to two characters per line.** `cache` ends up to the
*right* of `origin`, so the gutter `b.x - (a.x + a.w)` is **−538**. Clamped by
`Math.max(8, …)`, the 12-character label `"miss / stale"` wraps to
`["miss", "/", "stal", "e"]`. A negative gutter means the label is laid out
against a gap that does not exist.

**(c) Every arrow points at the top of its node.** Four lines make that label
block hang 21px above the origin (`labelY - half = -21`). Step 8 then clamps
the scene, shifting nodes down by 21px — but it only adjusts `node-box.y` and
`arrow.labelY`:

```ts
for (const el of elements) {
  if (el.kind === "node-box") el.y -= minY
  else if (el.kind === "arrow" && el.labelY !== undefined) el.labelY -= minY
}
height = Math.max(height - minY, height + grow)
```

`ArrowEl.d` and `.head` are **already-serialized path strings** built in step 6,
and they are never touched. So the nodes move down 21px while the arrows stay
put: every arrow floats 21px above its node's centre. With a 44px node, that
reads as "aligned to the top" — exactly the reported symptom.

**Defect (c) is a regression**, and defects (a)+(b) are its trigger. Rendering
the same fixture at `3d3592d~1` (the commit before edge-label wrapping) gives
`1556x148` with **0 misaligned arrows**: the scene was already too wide, but
nothing triggered the clamp, so nothing broke. `3d3592d` added
`wrapEdgeLabel`, which introduced the multi-line label, which introduced the
clamp. Both `howToIr` and `demoDocIr` (which reuses those blocks) are affected;
`figuresIr` is not.

### 1.1 Why "just fix the shift" is not enough

Fixing only (c) is a three-line change and it is genuinely correct — but it
leaves the figure at 1556px/0.49× with a `miss / / stal / e` label. The user
would still be looking at a small, hard-to-read diagram. (a) and (b) are the
cause; (c) is the symptom that made the cause visible.

### 1.2 The latent bug worth fixing regardless

(c) is reachable **without any cycle**: any figure whose edge-label block hangs
above the origin triggers it. The clamp is wrong on its own terms — it moves
geometry it is responsible for sizing, and forgets the geometry it emitted
earlier. §3.2 fixes it at the root, so the class of bug closes.

## 2. What ships

### 2.1 Cycle-aware layering (fixes a and b)

Replace capped relaxation with the standard two-phase approach:

1. **Classify** every edge with an iterative DFS (white/grey/black), marking
   any edge into a grey (on-stack) node as a **back edge**.
2. **Layer** using longest-path relaxation over the **forward edges only**.
   This terminates by construction: the subgraph is acyclic.

Back edges are excluded from layering but still rendered, with real direction.

Verified against the fixture — layers become `req=0 cache=1 fresh=2 origin=2
reval=3`, byte-identical to what the same spec produces with the cycle edge
deleted (748px wide). On a four-node graph with two overlapping cycles
(`a→b→c→d→b`, `c→a`) it yields `a=0 b=1 c=2 d=3`: two back edges, no
explosion.

Iteration order stays **spec order** everywhere, so output is deterministic —
the property the existing "deterministic even with cycles" comment was reaching
for and did not achieve.

### 2.2 Back edges route as a return path below the nodes

For `lr`: leave the source node's bottom edge, dip below every node, and enter
the target's bottom edge with the head pointing **up**. This is the standard
treatment for a feedback loop and reads as "revalidate feeds the cache again".

Two geometry details, both verified by prototype:

- **The control line is not the curve.** For a cubic with both control points
  at `ly` and endpoints at `y0`/`y3`, the actual extremum is
  `y(t*)` where `t* = u/(1+u)`, `u = √((ly-y0)/(ly-y3))`. For equal endpoints
  this collapses to the closed form **`depth = y0 + 0.75·(ly - y0)`** — the
  curve reaches only ¾ of the way to the control points. A first attempt that
  sized the scene from `ly` would have clipped the return path by ~26px.
  The implementation computes the depth **forward** (control depth → real
  depth), which is exact and needs no numeric inversion.
- **Coincident columns.** When source and target centres are within 1px the
  cubic degenerates, so that case emits the orthogonal 3-segment form.

`tb` mirrors the construction across the cross axis (return path in a lane to
the *right* of every node).

Each back edge gets its own lane (`LANE_PITCH`), so two cycles in one diagram
do not overlap.

### 2.3 The clamp moves geometry before it is serialized (fixes c)

Restructure so the clamp is applied to **node placement**, and edge paths are
built **afterwards** from the final node coordinates. Because every edge
coordinate derives from node `y`, a uniform shift needs no path surgery — the
paths are simply computed from the shifted nodes.

Z-order is *array order*, not *compute order*: the existing guarantee that
edges paint under nodes ("paint edges under nodes", `layoutFlow.ts` step 6/7) is
preserved by assembling the elements array in the same order as today while
computing the edge geometry later.

To know the shift before building edges, step 8's label-extent scan runs over
the **labels**, which are known from `labelX`/`labelY`/line count alone — all
computable before any path string exists. So the order becomes:

```
place nodes → compute edge label anchors & extents → clamp (shift nodes)
→ build edge paths from final nodes → assemble edges, then nodes
```

A consequence worth noting: with the shift applied before serialization, the
`ArrowEl.d`/`.head` strings are correct **by construction**, so there is no
string to keep in sync with node coordinates in future edits.

### 2.4 A negative gutter is now a warning, not a silent shred

With back edges routed separately, the only way to get `b.x - (a.x+a.w) < 0` on
a rendered edge is a genuine authoring error. `layoutFlow` already has a
warning channel (`figure-node-duplicate`, `figure-edge-dangling`,
`figure-edge-self`); add **`figure-edge-negative-gutter`** so this can never
again degrade quietly into two-character lines. This also rides the new
warnings channel from the no-degradation cycle, so a host using
`failOnWarning` will catch it.

## 3. Decisions and their alternatives

### 3.1 Back edges as curved return paths (chosen)

Curved return paths below the nodes. Alternatives rejected:

- **Reverse the edge** — simplest geometry, but silently discards the
  direction the model authored, which is the entire point of a feedback loop.
- **Leave the existing orthogonal gutter routing** — least new code, but a
  right-to-left edge threaded through a column gutter reads as a mistake.

### 3.2 Clamp-before-serialize, not path-string translation (chosen)

An earlier draft considered translating the `d`/`head` strings at clamp time
(regex over path coordinates). Rejected: it re-parses data the function just
produced, and any future path shape (arcs, extra segments) becomes a new
silent-misalignment site. Shifting node placement first makes the bug
unrepresentable. See §2.3.

### 3.3 DFS, not Kahn's algorithm

Kahn's algorithm detects cycles (nodes that never reach in-degree 0) but does
not tell you *which edges* to exclude. DFS grey-node classification yields the
specific back edges, which §2.2 needs. Iterative rather than recursive to avoid
a stack overflow on a pathological model-authored graph.

### 3.4 No new block type, no schema change

This is entirely inside `layoutFlow`. The IR, the schema, the block count, and
the README's `N primitives` figure are all untouched — so no README block-type
edit is required. The README's figure-layer section gets one sentence on
cycles, and `docs/ROADMAP.md` records the fix.

## 4. Scope boundaries

- **Not** changing the emit layer (`svg.ts`), the sketch pass, or the tokens.
- **Not** adding a `direction`-aware "reverse" mode.
- **Not** trying to make wide figures legible by other means (e.g. a
  `max-width`/scroll container). This fix removes the *cause* of the excess
  width for this fixture; open thread 8's 825px timeline budget is a separate,
  still-open question and stays open.
- **Not** changing node sizing, label wrapping, or gutter caps. The
  label-overflow spec's behaviour is preserved for well-formed input.

## 5. Verification

Because the reported symptom is *visual*, tests alone are insufficient. Gates:

1. `npx tsc --noEmit` — clean.
2. `npm test` — full suite, plus new cases in `tests/figures/layout-flow.test.ts`:
   - **invariant test**: for every diagram fixture, every arrow endpoint's
     path `y` equals the rendered node's centre `y + h/2`. This is the property
     that was violated; assert it structurally rather than by eyeballing.
   - **no-explosion test**: a cyclic spec's layer count equals its acyclic
     counterpart's (and the fixture's scene drops below ~900px).
   - **positive-gutter test**: every rendered edge has a non-negative gutter;
     no multi-line label has a line under 4 characters.
   - **back-edge test**: a back edge's path dips below every node box and its
     head points up into the target's bottom edge.
   - **clamp test**: a spec engineered to hang a label above the origin has
     zero misaligned arrows (this is the regression case).
   - **determinism test**: repeated calls produce identical output.
3. `npm run build`, then the **mandatory rendered-output diff** against the
   pre-fix build. Expected: the `howToIr`/`demoDocIr` diagram changes (that is
   the fix) and **nothing else does** — `figuresIr`, the chart, timeline, and
   every non-diagram figure must be byte-identical.
4. Real Chrome over CDP: assert node centre vs. arrow path `y` agree in the
   live DOM, the label reads `miss / stale` (not shredded), and the effective
   scale is ≥0.9.
5. All six demo routes still 200; `/` and `/document` carry the fixed diagram.

## 6. Risks

- **Determinism.** DFS classification depends on adjacency order; the
  implementation walks spec order only, and the test pins repeat-call equality.
- **Multiple back edges** could overlap if lanes are not offset per edge;
  `LANE_PITCH` is per-edge for this reason, with a test using two cycles.
- **Scene height growth** from return paths could surprise callers that assume
  `height` is the node extent. It already was not (the clamp grew it), so this
  is a continuation, not a break — but the tests assert containment.