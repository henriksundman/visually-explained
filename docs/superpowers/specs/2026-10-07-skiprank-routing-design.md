# Skip-rank edge routing + edge-label collision resolution (diagram `lr`/`tb`)

Date: 2026-10-07 · Status: approved (user asked for a recommendation per question, then
approved the recommendation: route = lane search with dip-below fallback; labels =
collision-driven nudging anchored to the fixed route; prompt-side-only label rule
rejected — the renderer must degrade deterministically)

**Parent ships from:** the `lr` backlog item, "Still rough, recorded not hidden"
(ROADMAP). Live instances: run 2 `dc→tcell` through the MHC node; run 3
`cytotoxic_t_cell→target_cell` through Granzymes — the figure the user reported at this
cycle's merge gate.

## 0. The defect, measured (merged dist `a45db9c`, exact model IR from run 3)

Reproduction is deterministic: `.superpowers/skiprank-repro.mjs` feeds the EXACT
model-authored IR (4 nodes, 5 edges, `direction: "lr"`) through `renderBlock("diagram",
…)` from dist and regenerates the served geometry. Route: `M 160 38 L 308 38 L 308 38
L 454 38` — one horizontal run at y=38 from x=160 to x=454. Nodes drawn AFTER the edge
(z-order), so the crossing is INVISIBLE: the line is paint­ed, then covered. The user's
screenshot must have caught the two stubs either side / the label (labels draw on top).

| measured | value |
|---|---|
| Granzymes node (rank 1 col) | x 224–316, y 16–60 |
| skip-edge horizontal run | y=38, x 160→454 — **crosses Granzymes for 92px, fully hidden** |
| edge label "Recognizes antigen on MHC I" | rect x 227–389 × y 25–39 (162px wide, 27 chars × 6.0 + pad) |
| label × Granzymes node | **1246px²** (user-visible text-on-node) |
| labels "Releases"(y=32) / "…apoptosis"(y≈24.7) | 3–10px apart — text-on-text (run 2's 1496px² case is the same mechanism at a different span) |

**Three code-path defects compound** (all `layoutFlow.ts`):
1. **Route.** Skip edges (`adjacent === false`) route orthogonally through
   `gutterX = a.x + a.w + (b.x - (a.x + a.w)) / 2` — arithmetic midpoint of the SPAN,
   which for the repro is 307: inside Granzymes. Nothing ever checks the chosen lane x
   against the intermediate columns' occupied x-intervals.
2. **Label anchor.** Skip label sits at `a.x + a.w + gutterW / 2` with
   `gutterW = b.x - (a.x + a.w)` — the same span-midpoint (307), deliberately placing
   the name on the crossing it should describe.
3. **Wrap width.** A skip edge's `gutterW` is the whole span (294px → 49-char lines),
   so long labels ship as ONE wide line centred on the defect. Adjacent labels instead
   wrap to the real gutter (that guard shipped 2026-10-02 and works).

Adjacent edges on the same source (`Releases` ×2) don't overlap today (y=32 vs y=68)
but only because ONE is a curve and one is a straight run; two straight skip edges from
one source land at THE SAME point (the recorded `tb` twin of this defect).

## 1. Why the scene-quality cycle couldn't fix this

`BLOCK_TYPE_DOCS` has no rule naming edge-label length or one-labelled-edge-per-source,
and even a correct contract line CANNOT address the route: the model's graph was
VALID (real edge, real label, nothing dropped). This is renderer work, and it was
explicitly excluded from that cycle's spec.

## 2. Decisions

1. **Lane search over the orthogonal route.** Keep the 3-segment orthogonal shape;
   choose WHICH gutter column the vertical leg runs through rather than taking the
   midpoint. The dip-below return-lane route (back-edge machinery) is the FALLBACK for
   when no clear corridor exists, not the default: defaulting to it would read as a
   feedback loop and eat a horizontal strip below the graph even when a clean corridor
   exists.
2. **Bypass through a clear Y band.** The horizontal bypass segment runs through a
   measured node-free band between (or above/below) the crossed columns' boxes —
   prototype-validated on the repro: segments `(160,38)→(196,38)→(196,74)→(386,74)→(386,38)→(454,38)`
   clear ALL box rects (bands computed: [72,76] between Granzymes y16–60 and Perforin
   y88–132).
3. **Label anchors to its own route's clear segment.** With the route fixed, the
   label's anchor is derived from a segment the geometry just proved clear, so
   label-on-node cannot recur structurally. No interval algebra for nodes at label time.
4. **Label-label collisions resolve by nudging** the colliding label's anchor along
   its clear segment in fixed steps (a `GAP_CROSS/2`-based step) until the rect
   intersection is 0; the FIRST label keeps its anchor (deterministic, spec order).
   Non-colliding labels never move (corpus discipline).
5. **No prompt change in this cycle.** The renderer must be able to degrade
   correctly for ANY valid graph the model emits. A `≤1 labelled edge per source`
   teaching line may be considered AFTER, as its own decision, once the renderer can't
   be broken by it.
6. **`tb` mirrors `lr`** by transposing the same selection (Y-bands ↔ X-corridors).
   The tb twin (skip label at source column centre) is fixed by the same change.

## 3. Design

### 3.1 Route selection (`lr`; `tb` transposed, same wire)

For a skip edge `a → b` (ranks ra < rb, crossed columns ra+1…rb−1):

1. **Corridor candidates.** For each gutter between consecutive crossed columns
   (including the gutters flanking them: right of `a`'s column, left of `b`'s), the
   lane x = gutter midpoint. Every adjacent-pair gutter is node-free by construction
   (`mainOffset` accumulation). Keep utters whose x-interval is clear of ALL boxes;
   order candidates by |laneX − spanMidpoint| and take the first.
2. **First leg from the source** goes through the gutter IMMEDIATELY RIGHT of a's
   column at the source's exit y — running the horizontal at exit-y past the first
   crossed column is the original bug shape, so the first horizontal leg must clear
   the first crossed column's band by ending at the first candidate lane x.
3. **Bypass Y band.** From the crossed columns' boxes (the ones whose band lies
   strictly between a's right edge and b's left edge), compute y-intervals; candidate
   bands are the gaps ≥ MIN_BAND (24px: stroke clearance) between consecutive
   intervals, above-all, and below-all; choose the band nearest the source/target row
   midline. If none exists → **dip-below fallback**: the current back-edge lane route
   (lanes stack by RETURN_LANE like back edges do, sharing `laneBase`).
4. **Route** = exit horizontal to lane x → vertical to bypass y → horizontal across
   the span at bypass y → vertical at the SECOND corridor (adjacent to b) → horizontal
   into b's left edge (tx − 2). Head as today. Serpentine case (lane count > 2
   corridors spanned): same construction chained per crossed column.
5. **Label anchor** = midpoint of the FIRST bypass segment (the clear horizontal at
   bypass y), labelY = bypass y − 6. Wrap width = the bypass segment's length (a real,
   measured clear width) — never the raw span. Multiple skip edges from one source:
   lanes stack downward from the first band (skipLane counter, like RETURN_LANE), so
   two straight skip edges no longer share a point.

### 3.2 Label nudging

After all anchors/wrap are computed: pairwise rect intersect (estimated char width,
`EDGE_CHAR_W`, mirroring the probe). For each colliding pair in spec order: the later
label steps along its route's clear axis (bypass y ± steps of GAP_CROSS/2; clamp to
the scene; last resort `dip` its lane) until clear or 4 steps exhausted → keep best
(least-overlap) position and MOVE ON (never loop). Adjacent-edge labels keep today's
anchors when not colliding.

### 3.3 What deliberately does NOT change

Adjacent edges, back edges, node layout, ranking, `.exp-*` classes, the CSV contract
(`ArrowEl` gains nothing — `labelX/labelY/lines` already exist). No schema change.

## 4. Tests (TDD, RED first)

1. **The live repro as a unit test**: the exact run-3 IR; every skip-edge segment
   intersects NO node rect; label rect intersects no node rect (the 1246px² case).
2. **Two straight skip edges from one source** don't share a point (the tb twin, now
   asserted in both directions).
3. **Tiled crossed column** (no clear band): fallback dip route, segments clear.
4. **Label collision nudge**: two colliding skip labels; first keeps anchor, second
   clears; determinism (same input → same output).
5. **Adjacent labels unchanged**: the existing demo/fixture adjacent-label geometry
   pins byte-for-byte where no collision exists (corpus gate enforces globally).
6. **tb mirror**: `direction: "tb"` skip edge routes via X-corridors with the same
   guarantees.
7. Old invariant stays: every rendered strand Geometry-checks GREEN in the shipped
   fixtures; corpus byte-identical or confined to the two new skip-edge figures in the
   added fixture (pure addition convention).

## 5. Acceptance + gates

- Per-task corpus gate against `.superpowers/corpus-main.txt` (same convention: vary
  only the build; demo fixtures held constant; any rendered diff confined to the NEW
  fixture's added line).
- Full suite + `tsc --noEmit` + build + 6/6 demo routes 200.
- Re-render `.superpowers/skiprank-figure.html` content through the fixed dist and
  re-measure with a CDP probe pass (scene-space, inverse-CTM as recorded): expect
  0 node-crossing segments, 0 label-on-node px².
- README `## Block types` NO count change (no new primitive); ROADMAP `lr` item flips
  "Still rough" → the routing half SHIPPED with both live instances cited; DEBUGGING
  Part-2 entry for "the renderer painted the crossing invisible" (z-order hiding) +
  "arithmetic midpoint ≠ geometrically clear lane".

## 6. Out of scope

Prompt-side label-count teaching; `rl`; edge-label wrap width for ADJACENT edges
(already correct); mind-map/tree routing; interactive behavior.
