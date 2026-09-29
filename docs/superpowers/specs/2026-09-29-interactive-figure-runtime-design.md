# Interactive Figure Runtime (Sliders + Play Sweep)

Date: 2026-09-29
Status: Approved (brainstorming 2026-09-29)
Follows: 2026-09-28-bespoke-figures-design.md (shipped), 2026-09-29-path-slots-epicycles-demo-design.md (shipped)

## Problem

The bespoke `figure` block ships a parametrized, expression-driven format whose
static render evaluates params once at `initial`. The parameters exist, the
expression evaluator caches nothing, and the interactive runtime that the
format was explicitly designed for has not been built. An LLM-authored figure
like the demo's Fourier epicycles is one `t` slider away from being a live
simulation, but today the reader can only look at it.

## Goal

A React client component that consumes the shipped figure format **unchanged**
(plus one optional authoring field): themed sliders bound to `params`, live
re-render on drag, and a play/pause sweep that animates one author-chosen
param across its range via `requestAnimationFrame`. Static render stays the
SSR and fallback path.

## Non-Goals (YAGNI)

- Timeline scrubber, speed control, loop/ping-pong modes.
- Animation of anything except one scalar param per figure.
- Non-React runtimes (vanilla/web-component adapter) — later, if asked for.
- Pointer/drag interaction on the SVG canvas itself.
- Reduced-motion gating (play is user-initiated, not autoplay).

## Decisions Locked (brainstorming 2026-09-29)

1. **Controls: sliders + play sweep.** One slider per param; play/pause
   sweeps one param across `[min, max]` with rAF, wrapping at `max`. No
   scrubber/speed UI in this cycle.
2. **React API: component + prop.** Export `<InteractiveFigure>` from
   `explanations/react`, and add `interactive?: boolean` (default `false`) to
   `<Explanation>` routing valid `figure` blocks to it. Default-off keeps
   `Explanation` a pure server component; RSC hosts are untouched.
3. **Sweep param: authorable via IR.** `figureBlockSchema` gains optional
   `sweep?: string` naming a param; absent/unknown names silently fall back
   to `params[0]`. The LLM knows which param animates meaningfully
   (`t` for the epicycles, not `r`).
4. **Perf: memoized parser inside the evaluator.** `parseExpr` results are
   memoized per unique expression string in a bounded module-level Map;
   `evaluate()` goes through it. The runtime reuses the existing pure
   `compileFigure` + `sceneToSvg` per tick (clone authored figure with current
   values) — no new artifact API, no public API change. React `useMemo`
   reuses the parsed/authored figure across ticks.

## Design

### 1. Expression memoization (`src/figures/expr.ts`)

- Module-level `const AST_CACHE = new Map<string, ExprAst>()`, capped at 1000
  entries; when full, clear it (simplest correct policy — caches must never
  grow unbounded on adversarial input).
- `parseExpr` consults the cache; on miss, parses and stores. `evaluate`
  already routes through `parseExpr`, so all consumers benefit: element
  fields, derived chains, path slots, per-tick runtime recompiles.
- Public behavior unchanged; SSR-safe (pure string keys → immutable ASTs).

### 2. Runtime component (`src/react/InteractiveFigure.tsx`)

- Directive `'use client'` at top. Props: `{ block: unknown; sketch?: boolean }`.
- One-time (useMemo on `block`): `salvage`-style lenient handling —
  `buildAuthored(block, warnings)` (exported from `primitives/figure.ts` so
  the runtime shares the exact salvage path). Warnings go to `console.debug`:
  the React string path (`renderBlock`) discards them silently today, and
  dev-console visibility beats silence without changing the render contract.
- Markup parity with the static primitive: the component emits the same
  `exp-block exp-figure` wrapper, `exp-fig-title`, and `exp-fig-caption` as
  `renderFigure`, with the controls row between SVG and caption — so flipping
  `interactive` on changes nothing visually except the added controls.
- State: `values: Record<string, number>` initialized from params' `initial`.
- Per render (useMemo on `values`): clone authored figure with each param's
  `initial` replaced by its current value → `compileFigure` → `sceneToSvg`
  (sketch pass included when `sketch`). Same escaping, theming, and tone
  discipline as the static render — identical SVG emitter, no second path.
- SSR/hydration: initial render is synchronous and deterministic from `block`
  alone (same output as the static render), so server HTML matches client.
- Controls markup below the SVG:
  - Per param: `<label>` (param name + live value) + `<input type="range">`
    with `min/max/step/value` from the param spec, `aria-label` = param name.
    `onChange` updates `values` (clamped and snapped to `step`).
  - Play/pause `<button>` rendered only when `params.length > 0`; sweeps the
    resolved sweep param (block `sweep` if it names a param, else `params[0]`).
- Play loop: `requestAnimationFrame`; each frame advances the sweep param by
  `step * (dt / 16.67ms)` (frame-rate independent), wrapping `max → min`;
  pause cancels the handle; unmount cancels via effect cleanup.
- Pure step function `nextSweepValue(current, { min, max, step }, dtMs)`
  exported for direct unit testing (wraps, clamps, frame-rate scaled).
- Zero-param figures render SVG only (no controls row). Figures whose
  elements all drop render the existing empty-state markup (same classes as
  static).

### 3. Wiring

- `src/react/Explanation.tsx`: new optional prop `interactive?: boolean`
  (default `false`). When true and a block is a valid `figure`, render
  `<InteractiveFigure block={b.data} sketch={sketch}/>` instead of the HTML
  string path. `components` override still wins (consumer override >
  interactive routing > static HTML).
- `src/react/index.ts` re-exports `InteractiveFigure`.
- No changes to `renderExplanation` or any core primitive — the HTML entry
  point stays static-only by design (documented in the spec; interactivity
  requires React).

### 4. IR + prompt

- `figureBlockSchema` gains `sweep: z.string().regex(identifier).optional()`
  (same identifier regex as params). No cross-field validation in schema —
  the runtime falls back leniently if `sweep` doesn't name a param.
- `systemPromptSnippet` figure line gains: sweep names the param play should
  animate (choose the one that makes the figure move meaningfully).
- `tests/presentation.test.ts` prompt assertions extended.

### 5. Demo

- `demo/interactive.html` served by `demo/server.mjs` at `/interactive`
  (link added to the main page). Loads React 19 + the built `explanations/react`
  from esm.sh via import map — demo-only external dependency; the library
  itself gains none. Renders `figuresIr` with `interactive` on, so the
  epicycles figure is draggable and playable (`sweep: "t"` added to the demo
  figure).
- `npm run demo` unchanged; the server route is added beside the existing ones.

## Error Handling

- Identical salvage semantics as static: bad elements drop with warnings;
  all-drop renders the empty-state; unknown `sweep` falls back to `params[0]`.
- A block that fails lenient parsing renders the empty-state figure, never
  throws (the only throw path is `<Explanation strict>` upstream, unchanged).
- rAF loop guards: cancels on unmount and on pause; no state updates after
  unmount.

## Testing (TDD)

- `tests/figures/expr.test.ts` — memoization: same AST object returned for
  repeated parses, distinct for distinct strings, cache clear at cap.
- `tests/react/interactive-figure.test.tsx` — via `renderToStaticMarkup`:
  initial SVG identical to static render for the same block; wrapper,
  title, and caption classes match the static primitive; controls markup
  (slider count/attrs, aria-labels, play button presence); zero-param → no
  controls; bad elements → SVG minus dropped element + empty-state on all
  drop; `sweep` fallback when unknown. `nextSweepValue` pure-table tests:
  advance, wrap at max, sub-step dt, zero/negative dt no-ops.
- `tests/react/explanation.test.tsx` — `interactive: true` routes figure
  blocks to the runtime markup (slider present in output); default leaves
  output byte-identical to today; `components` override wins over interactive.
- `tests/presentation.test.ts` — prompt documents `sweep`.
- `tests/demo-examples.test.ts` — epicycles fixture stays schema-valid with
  `sweep: "t"` (schema acceptance covered).
- Demo smoke: `/interactive` serves and contains slider + play markup.

## Roadmap Position

Fulfills the backlog item "Interactive figure runtime (next up)". The format
was shipped unchanged as promised; only the additive `sweep` field is new.
Backlog line removed and Shipped entry added on completion. Document IR +
sections (step 2 of the Curio arc) is the next spec, untouched by this one.
