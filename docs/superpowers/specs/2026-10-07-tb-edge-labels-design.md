# tb edge labels: real-width estimation, tb serpentine, bounded escapes

Status: approved direction (user, 2026-10-07: "Both, in that order" — this cycle first,
compile-prompt constraints second, then stop chasing model-output variety).
Evidence base: `.superpowers/shots/reharm-report.json` + ledger follow-up 3 (2026-10-07).

## Problem (measured, not aesthetic)

The reharmonization page's fig 1 ("The Parallel Minor (Aeolian) as a Source", direction
tb, viewBox 540×717) renders with:

- **4 label-on-label overlaps** (90–286px²) — e.g. "Diatonic Subdominant" × "Diatonic Supertonic"
- **2 labels outside the viewBox** ("Borrowed Supertonic" at x=−111.8; "Common Progression"
  at x+w=636.4 > 540)
- **5 edge labels 31.9–77.6px from their own edge** — unreadable as edge labels
- **6 labels crossed by foreign edge paths** (one box holds 8 groups' path points)

The run-4 cycle's collision nudge was verified to fire on lr fan-outs but does nothing here.
That is not a tuning failure — it is four distinct gaps, all in `layoutFlow.ts`:

| # | Gap | Proof |
|---|-----|-------|
| G1 | Label rects are **estimated** at `EDGE_CHAR_W = 6.0`/char; real 11px labels render at 6.3–7.3px/char (proportional font: `m`/`w` wide, spaces narrow). 2-line height est 29 vs real 31. | Reconstructed nudge arithmetic on all four fig-1 pairs: estimated rects sit **4–6px APART** (est overlap −56…−57px²) while real rects **overlap 90–286px²** — the nudge never fires. Blind to every collision it exists to fix. |
| G2 | tb non-adjacent edges still route the **arithmetic-midpoint gutter** (`M sx sy L sx gutterY L tx gutterY L tx ty`); the clear-corridor serpentine was wired **lr-only** (~line 755). | Labels at gutter midpoints of a column graph land where crossed ranks' boxes live — the same fallacy the run-3 cycle fixed for lr. |
| G3 | tb skips never `planIsSkip.set(...)` (that happens only in the lr branch), so the nudge treats them as non-skip: axis `"x"` (horizontal) instead of `"y"` (their bypass axis). | Same-anchor tb labels at y=125/140, y=290/305, y=425.5 share rows 15px apart — horizontal nudges of 80–135px-wide labels in a 540px scene cannot separate them. |
| G4 | Escape candidates are **unconstrained**: the analytic ladder happily jumps past the scene edge. | "Borrowed Supertonic" escaped to x=−111.8; "Common Progression" to 636.4. Off-canvas is worse than colliding: invisible, not just ugly. |

Secondary finding, recorded but NOT this cycle: edge labels carry no halo
(`.exp-edge-label` is plain text), so any label crossed by a foreign path is directly
illegible ("fits" labels × up to 11 groups / 45 path points each in fig 3).

## Design

### D1 — Superset invariant for label rects (G1)

The layout's estimated label rect must **contain** the real rendered rect: same anchor,
`est.w ≥ real.w`, `est.h ≥ real.h`. Replace the flat `EDGE_CHAR_W = 6.0` with a
per-character width table **measured once in Chrome** at the real label font/size
(`getComputedTextLength` per character, demo font stack), plus pad. Line height from
measured pitch + ascent/descent, not the current `(n−1)·15 + 14`. No DOM at layout
time — the table is baked constants; the estimate stays deterministic.

Consumers to move together (they must agree or nudges re-blind): `rectOfLabel` (7c),
`wrapEdgeLabel` (§3.1 wrap width), `blockH` (cross-gap widening), the tb skip
strip-check. Node-width estimates (`nodeWidth`, `CHAR_W`) are OUT — different wrap
path with padding slack, and changing it churns every fixture for no measured defect.

Tests: adversarial strings (m/w-heavy, i/l-heavy, digits, spaces) pin
`est ≥ real` at the measured extremes; the four fig-1 pairs become a fixture where the
nudge MUST now fire.

### D2 — tb serpentine (G2, G3)

Transpose the lr clear-corridor serpentine: corridors are row gutters, bypass bands are
the x-gaps between crossed boxes' extents, the bypass segment is vertical. tb skips set
`planIsSkip` and anchor their labels on the bypass segment (node overlap structurally
impossible, same argument as lr §3.1). The nudge's skip axis then follows automatically
(tb skip ⇒ axis "y").

### D3 — Bounded escapes (G4)

Escape candidates outside `[PAD, scene − PAD]` (per axis, per current scene size) are
rejected; the ladder gains a final **clamped** candidate. Priority: in-bounds clear >
in-bounds clamped (may still overlap — accepted, and recorded) > original anchor.
**Never out of bounds.** An unresolvable collision stays visible; that trade is the
DEBUGGING entry, not a silent choice.

### D4 — Edge-label halo (secondary finding, cheap)

`paint-order: stroke` + background-colored stroke on `.exp-edge-label` in `tokens.css`
so a label remains readable wherever it still crosses a line. CSS-only — corpus HTML
byte-identical (tokens.css is external). Needs the theme background token; if themes
lack one, add it to the token set and the theme test.

## Non-goals

- **Label-vs-foreign-path avoidance in layout** (the `fits` density) — model behavior;
  addressed by the compile-prompt half of the decision (fewer labelled edges, never the
  same word twice, prefer renderer-laid-out `diagram` blocks over hand-placed `figure`
  scenes). A layout pass that dodges all foreign paths is a future cycle only if the
  prompt half proves insufficient.
- tb return-curve `cubicDepth` bulge (pre-existing recorded thread — separate cycle).
- Node-width estimation (see D1).

## Tasks

1. **T1 measure + table**: Chrome measurement script (scratch), bake table, move the four
   consumers, red-first tests (superset property; fig-1 fixture where nudge must fire).
2. **T2 tb serpentine**: transposed helpers + wiring + `planIsSkip` + bypass anchors;
   unit tests with a run-4-fig-1-shaped fixture (midpoint route must be gone).
3. **T3 bounded escapes**: in-bounds rejection + clamped fallback; unit tests
   reproducing the x=−111.8 escape.
4. **T4 halo**: CSS + theme coverage test; Chrome-verified stroke renders.
5. **T5 acceptance + docs**: re-render both saved IRs through the new dist
   (`.superpowers/rerender-saved-ir.mjs`), probe with `.superpowers/shoot-legibility.mjs`:
   reharm fig 1 — 0 label-label, 0 outside, every edge label within 24px of its own edge
   (was up to 77.6); no regression on the other nine figures (mRNA 0/0/0 stands);
   corpus diff limited to expected labelled-edge lines. ROADMAP line + DEBUGGING entry
   in the same commit as the code that changes behavior.

## Acceptance gates

tsc clean; full suite green; build green; 6/6 routes; corpus gate per task;
probe numbers above; both real pages re-probed, not unit fixtures alone
(the estimate-vs-real trap is exactly what unit fixtures cannot catch).
