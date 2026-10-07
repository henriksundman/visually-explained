# Plan: tb edge labels — superset width invariant, tb serpentine, bounded escapes

Spec: `docs/superpowers/specs/2026-10-07-tb-edge-labels-design.md`.
Branch: `fix/tb-edge-labels` off 40fd0ff. Per-task commits; corpus gate per render-affecting task.

Baseline numbers (reharm page, current dist): fig 1 = 4 label-label overlaps, 2 outside,
5 orphaned (max own-distance 77.6px), 6 on-foreign-line; fig 3 = 7 `fits` labels × up to
11 foreign groups. mRNA page 0/0/0 across 8 figures. Probe: `.superpowers/shoot-legibility.mjs`
(reports land in `.superpowers/shots/<prefix>-report.json`). Saved IRs re-render through
current dist with `.superpowers/rerender-saved-ir.mjs` — NEVER probe last run's HTML.

## Task 1 — measured char-width table (G1)

Red-first in `tests/figures/layout-flow.test.ts`:
1. Pin the superset property against the CURRENT baked numbers once measured:
   `estWidth("Common Progression") ≥ 130`, `estWidth("Diatonic Supertonic") ≥ 120`,
   `estWidth("Borrowed Submediant") ≥ 135` (real widths from reharm-report.json),
   plus m/w-heavy vs i/l-heavy adversarial strings.
2. Two-line height: `estHeight(2 lines) ≥ 31`.

Steps:
- Scratch CDP script (`.superpowers/measure-chars.mjs`): per-character
  `getComputedTextLength()` at the real `.exp-edge-label` size (11px) in the demo font
  stack; measure the full printable set actually usable in labels.
- Bake `EDGE_CHAR_W_TABLE` (+ pad) into `layoutFlow.ts`; derive single-line width as the
  table sum, 2+ line height from measured pitch (expect ≥ 15.5/line + ~2).
- Move ALL rect consumers together so they cannot disagree: `rectOfLabel` (7c nudge),
  `wrapEdgeLabel` (wrap width), `blockH` (cross-gap widening), the tb back-edge skip
  strip check. `nodeWidth`/`CHAR_W` untouched (spec non-goal).
- Corpus gate: diff rendered corpus; enumerate any changed labelled-edge lines as
  expected (wider estimate ⇒ earlier wrap).

Verify: tsc, suite green, corpus diff enumerated.

## Task 2 — tb serpentine + planIsSkip + bypass anchors (G2, G3)

Red-first:
- Fixture shaped like reharm fig 1: tb graph, one source fanning out ≥3 labelled
  skip edges to non-adjacent ranks, plus a same-row pair of long labels.
  Assert: no label-label overlap > 2px in the emitted scene (currently RED, overlaps 90–286px²),
  labels anchored ON their bypass segments (own-distance ≤ 24 — needs the probe-style
  metric in-process: route points are available at layout time, no DOM needed),
  and the old midpoint route `M sx sy L sx gutterY L tx gutterY L tx ty` is gone.

Steps:
- Transpose the serpentine helpers (`routeSerpentine`/`clearCorridorsX`/`clearBandsY`/
  `segmentClearsBoxes`) to tb: corridors = row gutters, bands = x-gaps between crossed
  boxes' extents, bypass segment vertical, cross gaps widen along x by `blockW`.
- tb skip branch: `planIsSkip.set(edgeKey(e), true)`; label anchored on the bypass
  segment (mid-x of the vertical segment, y at the band center); wrap width = segment length.
- Re-read the tb back-edge branch's existing `planIsSkip` strip check (~line 692) and keep
  its contract intact — back-edge labels stay in the below-graph strip (68ab0bd).
- The nudge's skip axis (`direction === "lr" ? "x" : "y"`) is then correct without editing 7c.

Verify: tsc, suite, corpus gate, temp-fig probe of the fixture scene.

## Task 3 — bounded escapes (G4)

Red-first: fixture where the analytic escape target is past the scene edge
(reproduces "Borrowed Supertonic" x=−111.8): assert every emitted label rect
intersects `[0, sceneW] × [0, sceneH]`.

Steps:
- In 7c: reject candidates outside `[PAD, scene − PAD]` per axis (scene size known
  at that point in the function); append a final **clamped** candidate to the ladder
  (`clamp(base ± escape)` into bounds); keep the "clear of ALL labels" winner rule.
- Clamped-candidate collision is accepted and recorded — visible beats invisible.
- DEBUGGING entry: estimate-vs-real guard blindness (G1) + never-escape-bounds rule.

Verify: tsc, suite, corpus gate.

## Task 4 — edge-label halo (D4)

- Check `tokens.css` for a background token; add `--exp-bg` to the token set + both
  themes if missing (theme test pattern pins token presence).
- `.exp-edge-label { paint-order: stroke; stroke: var(--exp-bg); stroke-width: 3px; }`
  (stroke-linejoin round). CSS-only: corpus HTML byte-identical.
- Theme class-coverage test (the 2026-10-03 rule: assert the rule exists AND the markup
  carries `.exp-edge-label` — a fixture with a labelled edge pins the markup side).

Verify: suite, corpus byte-identical, Chrome screenshot shows halo over a crossing.

## Task 5 — acceptance + docs

- Re-render BOTH saved IRs through the new dist; probe both pages.
  Acceptance: reharm fig 1 = 0 label-label, 0 outside, every edge label own-distance
  ≤ 24px (was 77.6); no figure regresses vs today's baseline (fig 0/2/3/4 + mRNA 0/0/0);
  fig 2's outside "Parallel" gone or explained.
- Corpus gate final; tsc; build; 6/6 routes on relaunched server.
- Docs in the same commit as the behavior they describe: ROADMAP (tb half flip to Fixed
  when verified), DEBUGGING (entries per task), README untouched (no new block type).
- Ledger: "Branch finished (MERGE GATE)" entry with probe numbers; NOT merged.

## Gate order per task

red tests → implementation → suite green → corpus gate → commit.
Probe against RE-RENDERED saved IRs only (the stale-HTML trap, ledger 2026-10-07).
