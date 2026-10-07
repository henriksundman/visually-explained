# Plan: skip-rank edge routing + label nudging

Spec: `docs/superpowers/specs/2026-10-07-skiprank-routing-design.md` (both live
instances cited there). Branch `fix/skiprank-routing` off ee14044. Layout file is
`src/figures/layoutFlow.ts`; tests in `tests/figures/layout-flow.test.ts` (existing
file for this layout — confirm name; else create beside `.spec` siblings). One opaque
rule for every task: hold demo fixtures constant, diff the corpus.

**Task 0 — baseline.** Corpus baseline on the branch: `npm run build && node
.superpowers/render-fixtures.mjs dist .superpowers/corpus-skip-main.txt && diff
.superpowers/corpus-main.txt .superpowers/corpus-skip-main.txt` → expect IDENTICAL
(no rendered change since the earlier baseline).

**Task 1 — geometry helpers + selection (route).**
1. In `layoutFlow.ts` add (module scope, near RETURN_*):
   `MIN_BAND = 24` (min clear band height), `LANE_INSET = 8` (clearance a corridor
   keeps from column band edges), `SKIP_LANE_DROP = 26` (vertical pitch between
   stacked skip lanes; mirror of RETURN_LANE), `NUDGE_STEP = GAP_CROSS / 2` = 14,
   `MAX_NUDGE_STEPS = 4`.
2. Add **published-for-tests helpers** (export, pure, box-rect input → output; no
   layout coupling; unit-testable WITHOUT a scene):
   - `clearBandsY(boxes, y0, y1): number[]` — gaps ≥ MIN_BAND between sorted
     y-intervals of `boxes` ∩ [y0,y1] (padding halves each side, as prototyped).
   - `clearCorridorsX(columns, boxes): number[]` — gutter midpoints whose
     x-interval intersects NO box.
   - `segmentClearsBoxes(p1, p2, boxes): boolean`.
   - `routeSerpentine(a, b, boxes, laneIndex, height)` → the 5-point polyline for
     `lr` (transposed call for `tb`),选位 rules per spec §3.1: corridors ordered by
     distance from span midpoint; first leg short-hop into the FIRST corridor;
     bypass y from `clearBandsY` (nearest to src row midline → else dip lane via
     laneIndex · SKIP_LANE_DROP below all crossed boxes).
   - `nudgeOverlap(state)` — pairwise estimated rect intersections among labels;
     moves the later label in each colliding pair along its clear axis by
     NUDGE_STEP up to MAX_NUDGE_STEPS; returns moved positions (never the first
     label of a pair).
3. **RED tests first** (from spec §4): unit tests on helpers with minimal box sets
   including the EXACT run-3 geometry (16,16,144,44 / 224,16,92,44 / 224,88,90,44 /
   456,16,122,44): corridor list = [196±8, 386±8]; bands = [72,76]; serpentine
   segments clear; tiled-column fallback triggers dip; determinism.
4. Corpus gate → expect IDENTICAL (helpers not yet wired).

**Task 2 — wire the selection into layoutFlow.**
1. In step 6b's non-back `lr` branch, replace the skip-edge `gutterX` midpoint with
   `routeSerpentine(...)`; `laneIndex` = per-source skip counter (NOT per-edge) so
   two straight-skips off one source stack lanes. Same for `tb` (transposed).
2. Label anchors derive from the serpentine's first bypass segment midpoint (x mid,
   y = band − 6 — i.e. ABOVE the bypass line), wrap line width = that segment's
   actual length; `labelX/labelY/lines` feed the existing `ArrowEl`.
3. Run every existing fixture a second time and assert NO rendered change for
   blocks whose graphs contain no skip edges: cover with a test that renders each
   demo fixture's diagram blocks before/after (snapshot by extracting only
   `exp-diagram` blocks). Also: adjacent-label positions pinned.
4. Corpus gate. Expect: identical UNLESS a shipped fixture has a skip edge — the
   demo deliberately has NONE (recorded in fixture comment), so expect IDENTICAL.

**Task 3 — DtD tests on the whole renderer.**
1. End-to-end render test: `renderBlock("diagram", …)` with the run-3 IR from dist
   (same shape as `.superpowers/skiprank-repro.mjs`, but as a unit test against
   `src/`); assert the emitted `d` attribute of the skip edge contains no segment
   whose rect intersect ANY node rect (parse the polyline from SVG, not from
   layout internals — the emitter is the contract).
2. Two straight skip edges from one source → different bypass y (no shared
   anchor point).
3. Colliding skip labels: first keeps anchor, second moved by NUDGE_STEP; input
   determinism (JSON.stringify-round-trip keying).
4. tb twin: `direction: "tb"` skip edge with a crossed column → corridor route via
   Y↔X transposition, no box crossing.
5. Corpus gate → IDENTICAL expected again (nothing shipped uses skip edges).

**Task 4 — live-figure fixture + docs.**
1. ADD a new diagram fixture line to `demo/examples.js` shaped like the run-3
   repro (4 nodes, 5 edges, one labelled skip edge) in a section that already
   uses diagrams, with a comment naming the cycle. This is a deliberately
   previously-absent case (the demo's fixture previously CLAIMED to avoid it) — the
   rendered output diff must be confined to that one added line (pure insertion).
2. ROADMAP: flip the `lr` "Still rough" bullet to SHIPPED (route fixed via lane
   search, labels nudged, both live instances cited; the LABEL-AT-SOURCE-
   COLUMN-CENTRE half of the item becomes fixed too).
3. DEBUGGING Part-2 entry: "the renderer painted the crossing invisible" (z-order
   made the defect unobservable from the HTML alone until the user reported its
   label; a test suite never rendered the intermediate-masked case) + "arithmetic
   midpoint is not a geometrically clear lane" (the whole class of bug).
4. Final gates: full suite, tsc, build, 6/6 routes, corpus confined to the new
   fixture line, ledger line, merge gate (NO auto-merge).

## Deviations log (fill at commit time)

| expected | actual |
|---|---|
| (awaiting implementation) | |
